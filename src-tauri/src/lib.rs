mod art;
mod inventory;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use inventory::{Def, ItemDef, Stack};
use rdev::{listen, EventType};
use serde::Serialize;
use steamworks::{AppId, Client};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};

const APP_ID: u32 = 3419430;
/// Same cap the game uses before an i32 stat would overflow.
const MAX_STAT: i32 = 2_147_483_646;
/// The game uploads stats once a minute.
const STORE_EVERY: Duration = Duration::from_secs(60);
const TICK: Duration = Duration::from_millis(16);

// Timings and item ids as the game uses them.
const DROP_EVERY: Duration = Duration::from_secs(60);
const PROMO_EVERY: Duration = Duration::from_secs(900);
const MANUAL_TOKEN_EVERY: Duration = Duration::from_secs(420);
const DROP_GENERATOR: Def = 10;
const CHEST_TOKEN: Def = 98;
const EMOTE_CHEST_TOKEN: Def = 90;
const ACHIEVEMENT_TOKEN: Def = 97;
const MANUAL_TOKEN: Def = 96;
/// Drops stop once both chest token kinds reach this count.
const TOKEN_CAP: u32 = 10;
const CHEST_PRICE: i32 = 1000;
/// Duplicate exchanges: 10 items of one quality -> 1 item of the next.
/// cosmetics common..epic = 16..19, emotes common..epic = 30..33.
const CRAFT_RECIPES: [Def; 8] = [16, 17, 18, 19, 30, 31, 32, 33];
const CRAFT_INPUT: u32 = 10;

#[derive(Clone, Copy, Serialize)]
struct Score {
    current: i32,
    lifetime: i32,
}

/// Mirrors the game's three stats: taps earned, lifetime taps, taps spent.
struct Stats {
    tap: i32,
    beat: i32,
    minus: i32,
}

impl Stats {
    fn score(&self) -> Score {
        Score { current: (self.tap - self.minus).max(0), lifetime: self.beat }
    }
}

#[derive(Clone, Serialize)]
struct Owned {
    def: Def,
    qty: u32,
}

#[derive(Default)]
struct Shared {
    steam: Option<Client>,
    art: Option<PathBuf>,
    stats: Mutex<Option<Stats>>,
    notice: Mutex<Option<String>>,
    catalog: Mutex<Option<Vec<ItemDef>>>,
    stacks: Mutex<Option<Vec<Stack>>>,
    /// Serializes inventory changes so two clicks can't spend the same items.
    busy: Mutex<()>,
    ignore_mouse: AtomicBool,
}

type Sh<'a> = State<'a, Arc<Shared>>;

#[tauri::command]
fn get_art(state: Sh) -> Option<String> {
    state.art.as_ref().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_score(state: Sh) -> Option<Score> {
    state.stats.lock().unwrap().as_ref().map(Stats::score)
}

#[tauri::command]
fn get_notice(state: Sh) -> Option<String> {
    state.notice.lock().unwrap().clone()
}

#[tauri::command]
fn get_catalog(state: Sh) -> Option<Vec<ItemDef>> {
    state.catalog.lock().unwrap().clone()
}

#[tauri::command]
fn get_inventory(state: Sh) -> Option<Vec<Owned>> {
    state.stacks.lock().unwrap().as_deref().map(owned)
}

#[tauri::command]
fn set_ignore_mouse(state: Sh, ignore: bool) {
    state.ignore_mouse.store(ignore, Ordering::Relaxed);
}

#[tauri::command]
fn open_menu(app: AppHandle) -> Result<(), String> {
    show_menu(&app).map_err(|e| e.to_string())
}

/// Opens a chest ("cosmetic" or "emote") for CHEST_PRICE taps. Returns the item won.
#[tauri::command]
async fn open_chest(app: AppHandle, kind: String) -> Result<Def, String> {
    blocking(app, move |app, sh| {
        let (recipe, token) = match kind.as_str() {
            "cosmetic" => (20, CHEST_TOKEN),
            "emote" => (34, EMOTE_CHEST_TOKEN),
            _ => return Err("unknown chest".into()),
        };
        let affordable = sh.stats.lock().unwrap().as_ref().is_some_and(|s| s.score().current >= CHEST_PRICE);
        if !affordable {
            return Err("Not enough taps".into());
        }
        let stacks = sh.stacks.lock().unwrap().clone().ok_or("Inventory not loaded yet")?;
        let mut inputs = Vec::new();
        for def in [token, ACHIEVEMENT_TOKEN, MANUAL_TOKEN] {
            inputs.extend(inventory::pick(&stacks, def, 1).ok_or("No chest token yet")?);
        }
        let result = inventory::exchange(recipe, &inputs);
        refresh(app, sh);
        let won = result?
            .iter()
            .map(|s| s.def)
            .find(|d| ![CHEST_TOKEN, EMOTE_CHEST_TOKEN, ACHIEVEMENT_TOKEN, MANUAL_TOKEN].contains(d))
            .ok_or("The chest was empty")?;
        // Like the game: taps are only spent once Steam confirmed the exchange.
        spend(app, sh, CHEST_PRICE);
        bump_stat(sh, "TotalItems");
        Ok(won)
    })
    .await
}

/// Exchanges duplicates: `items` (def, qty) must add up to a multiple of 10 and all
/// share the quality the recipe expects (Steam enforces that). Returns items won.
#[tauri::command]
async fn craft(app: AppHandle, recipe: Def, items: Vec<(Def, u32)>) -> Result<Vec<Def>, String> {
    blocking(app, move |app, sh| {
        if !CRAFT_RECIPES.contains(&recipe) {
            return Err("unknown recipe".into());
        }
        let total: u32 = items.iter().map(|i| i.1).sum();
        if total == 0 || !total.is_multiple_of(CRAFT_INPUT) {
            return Err(format!("needs a multiple of {CRAFT_INPUT} items"));
        }
        let input_defs: Vec<Def> = items.iter().map(|i| i.0).collect();
        let mut queue = items;
        let mut won = Vec::new();
        while !queue.is_empty() {
            // Take the next 10 units, spanning items as needed.
            let mut batch = Vec::new();
            let mut need = CRAFT_INPUT;
            while need > 0 {
                let (def, qty) = &mut queue[0];
                let take = (*qty).min(need);
                batch.push((*def, take));
                *qty -= take;
                need -= take;
                if *qty == 0 {
                    queue.remove(0);
                }
            }
            let stacks = sh.stacks.lock().unwrap().clone().ok_or("Inventory not loaded yet")?;
            let mut inputs = Vec::new();
            for (def, qty) in batch {
                inputs.extend(inventory::pick(&stacks, def, qty).ok_or("You don't own enough of that item")?);
            }
            let result = inventory::exchange(recipe, &inputs);
            refresh(app, sh);
            let result = result?;
            bump_stat(sh, "Exchanges");
            won.extend(result.iter().map(|s| s.def).filter(|d| !input_defs.contains(d)).take(1));
        }
        Ok(won)
    })
    .await
}

/// Counts an emote use; consumables also lose one copy.
#[tauri::command]
async fn use_emote(app: AppHandle, def: Def) -> Result<(), String> {
    blocking(app, move |app, sh| {
        bump_stat(sh, "EmotesUsed");
        let consumable = sh
            .catalog
            .lock()
            .unwrap()
            .iter()
            .flatten()
            .any(|d| d.id == def && d.tags.split(';').any(|t| t == "itemslot:consumable"));
        if consumable {
            let stacks = sh.stacks.lock().unwrap().clone().unwrap_or_default();
            let (instance, qty) = inventory::pick(&stacks, def, 1).ok_or("You don't own that item")?[0];
            let result = inventory::consume(instance, qty);
            refresh(app, sh);
            result?;
        }
        Ok(())
    })
    .await
}

/// Runs an inventory-changing operation off the async runtime, one at a time.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&AppHandle, &Shared) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sh = app.state::<Arc<Shared>>().inner().clone();
        if sh.steam.is_none() {
            return Err("Steam not available".into());
        }
        let _guard = sh.busy.lock().unwrap();
        f(&app, &sh)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn owned(stacks: &[Stack]) -> Vec<Owned> {
    let mut out: Vec<Owned> = Vec::new();
    for s in stacks {
        match out.iter_mut().find(|o| o.def == s.def) {
            Some(o) => o.qty += s.qty,
            None => out.push(Owned { def: s.def, qty: s.qty }),
        }
    }
    out
}

/// Reloads the inventory from Steam and tells the windows.
fn refresh(app: &AppHandle, sh: &Shared) {
    match inventory::all_items() {
        Ok(stacks) => {
            eprintln!("inventory loaded: {} stacks", stacks.len());
            let _ = app.emit("inventory", owned(&stacks));
            *sh.stacks.lock().unwrap() = Some(stacks);
        }
        Err(e) => eprintln!("inventory refresh failed: {e}"),
    }
}

fn spend(app: &AppHandle, sh: &Shared, amount: i32) {
    let mut stats = sh.stats.lock().unwrap();
    let Some(s) = stats.as_mut() else { return };
    s.minus = s.minus.saturating_add(amount).min(MAX_STAT);
    if let Some(c) = &sh.steam {
        let us = c.user_stats();
        let _ = us.set_stat_i32("BongoMinus", s.minus);
        let _ = us.store_stats();
    }
    let _ = app.emit("score", s.score());
}

fn bump_stat(sh: &Shared, name: &str) {
    if let Some(c) = &sh.steam {
        let us = c.user_stats();
        if let Ok(v) = us.get_stat_i32(name) {
            let _ = us.set_stat_i32(name, v.saturating_add(1));
            let _ = us.store_stats();
        }
    }
}

fn notify(app: &AppHandle, shared: &Shared, msg: String) {
    eprintln!("{msg}");
    *shared.notice.lock().unwrap() = Some(msg.clone());
    let _ = app.emit("notice", msg);
}

fn show_menu(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("menu") {
        w.show()?;
        return w.set_focus();
    }
    WebviewWindowBuilder::new(app, "menu", WebviewUrl::App("index.html".into()))
        .title("BongoCatBuddy")
        .inner_size(760.0, 560.0)
        .min_inner_size(560.0, 420.0)
        .center()
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let steam = Client::init_app(APP_ID);
    let exit_client = steam.as_ref().ok().cloned();

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(move |app| {
            let handle = app.handle().clone();
            let (client, steam_error) = match steam {
                Ok(c) => (Some(c), None),
                Err(e) => (None, Some(format!("Steam not available: {e:?}"))),
            };
            let install_dir = client
                .as_ref()
                .map(|c| c.apps().app_install_dir(AppId(APP_ID)))
                .filter(|d| !d.is_empty());
            let shared = Arc::new(Shared {
                art: art::ensure(&app.path().app_data_dir()?, install_dir.as_deref()),
                steam: client,
                ..Default::default()
            });
            app.manage(shared.clone());
            if let Some(e) = steam_error {
                notify(&handle, &shared, e);
            }

            let open = MenuItem::with_id(app, "menu", "Open menu", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&Menu::with_items(app, &[&open, &quit])?)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "menu" => {
                        let _ = show_menu(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let taps = Arc::new(AtomicU32::new(0));
            spawn_input(handle.clone(), shared.clone(), taps.clone());
            thread::spawn(move || main_loop(handle, shared, taps));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_art,
            get_score,
            get_notice,
            get_catalog,
            get_inventory,
            set_ignore_mouse,
            open_menu,
            open_chest,
            craft,
            use_emote
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(move |_, event| {
            if let (RunEvent::Exit, Some(c)) = (event, &exit_client) {
                let _ = c.user_stats().store_stats();
            }
        });
}

/// Counts key and mouse-button presses anywhere on the system. Held keys
/// count once (auto-repeat is ignored).
fn spawn_input(app: AppHandle, shared: Arc<Shared>, taps: Arc<AtomicU32>) {
    thread::spawn(move || {
        let mut held = HashSet::new();
        let sh = shared.clone();
        let result = listen(move |e| match e.event_type {
            EventType::KeyPress(k) if held.insert(k) => {
                taps.fetch_add(1, Ordering::Relaxed);
            }
            EventType::KeyRelease(k) => {
                held.remove(&k);
            }
            EventType::ButtonPress(_) if !sh.ignore_mouse.load(Ordering::Relaxed) => {
                taps.fetch_add(1, Ordering::Relaxed);
            }
            _ => {}
        });
        if let Err(e) = result {
            notify(
                &app,
                &shared,
                format!("Can't read keys ({e:?}). Allow Input Monitoring/Accessibility, then restart."),
            );
        }
    });
}

/// Pumps Steam callbacks, turns counted presses into taps, keeps the stats in sync
/// and runs the game's background inventory timers.
fn main_loop(app: AppHandle, sh: Arc<Shared>, taps: Arc<AtomicU32>) {
    let mut pending: i32 = 0;
    let mut last_store = Instant::now();
    // None = never ran, so everything fires right after start.
    let (mut last_drop, mut last_promo, mut last_manual) = (None::<Instant>, None::<Instant>, None::<Instant>);
    let due = |t: Option<Instant>, every: Duration| t.is_none_or(|t| t.elapsed() >= every);

    if sh.steam.is_some() {
        let (app, sh) = (app.clone(), sh.clone());
        thread::spawn(move || refresh(&app, &sh));
    }

    loop {
        thread::sleep(TICK);
        let n = taps.swap(0, Ordering::Relaxed).min(MAX_STAT as u32) as i32;
        if n > 0 {
            let _ = app.emit("tap", n);
            pending = pending.saturating_add(n);
        }
        let Some(client) = &sh.steam else { continue };
        client.run_callbacks();
        let us = client.user_stats();

        if sh.catalog.lock().unwrap().is_none()
            && let Some(defs) = inventory::definitions()
        {
            eprintln!("item catalog loaded: {} definitions", defs.len());
            let _ = app.emit("catalog", &defs);
            *sh.catalog.lock().unwrap() = Some(defs);
        }

        // Stats arrive shortly after init; taps made before that are kept in `pending`.
        let mut stats = sh.stats.lock().unwrap();
        let mut changed = pending > 0;
        if stats.is_none() {
            let (Ok(tap), Ok(beat), Ok(minus)) = (
                us.get_stat_i32("BongoTap"),
                us.get_stat_i32("BongoBeat"),
                us.get_stat_i32("BongoMinus"),
            ) else {
                continue;
            };
            eprintln!("steam stats loaded: BongoTap={tap} BongoBeat={beat} BongoMinus={minus}");
            *stats = Some(Stats { tap: tap.max(minus), beat, minus });
            changed = true;
        }
        let s = stats.as_mut().unwrap();
        if changed {
            s.tap = s.tap.saturating_add(pending).min(MAX_STAT);
            s.beat = s.beat.saturating_add(pending).min(MAX_STAT);
            pending = 0;
            let _ = us.set_stat_i32("BongoTap", s.tap);
            let _ = us.set_stat_i32("BongoBeat", s.beat);
            let _ = app.emit("score", s.score());
        }
        if last_store.elapsed() >= STORE_EVERY {
            let _ = us.store_stats();
            eprintln!("steam stats stored: BongoTap={} BongoBeat={}", s.tap, s.beat);
            last_store = Instant::now();
        }
        drop(stats);

        // Background inventory jobs, each on its own thread so taps never stall.
        let Some(stacks) = sh.stacks.lock().unwrap().clone() else { continue };
        if due(last_drop, DROP_EVERY) {
            last_drop = Some(Instant::now());
            inventory::heartbeat();
            if inventory::count(&stacks, CHEST_TOKEN) < TOKEN_CAP
                || inventory::count(&stacks, EMOTE_CHEST_TOKEN) < TOKEN_CAP
            {
                background(&app, &sh, || inventory::trigger_drop(DROP_GENERATOR));
            }
        }
        if due(last_promo, PROMO_EVERY) {
            last_promo = Some(Instant::now());
            background(&app, &sh, inventory::grant_promos);
        }
        if inventory::count(&stacks, MANUAL_TOKEN) == 0 && due(last_manual, MANUAL_TOKEN_EVERY) {
            last_manual = Some(Instant::now());
            background(&app, &sh, || inventory::add_promos(&[ACHIEVEMENT_TOKEN, MANUAL_TOKEN]));
        }
    }
}

/// Runs an inventory job on a thread and reloads the inventory if it granted anything.
fn background(
    app: &AppHandle,
    sh: &Arc<Shared>,
    job: impl FnOnce() -> Result<Vec<Stack>, String> + Send + 'static,
) {
    let (app, sh) = (app.clone(), sh.clone());
    thread::spawn(move || match job() {
        Ok(items) if !items.is_empty() => {
            let _guard = sh.busy.lock().unwrap();
            refresh(&app, &sh);
        }
        Ok(_) => {}
        Err(e) => eprintln!("inventory job failed: {e}"),
    });
}
