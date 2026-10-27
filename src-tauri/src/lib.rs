mod art;
#[cfg(debug_assertions)]
mod devdriver;
mod inventory;
mod lobby;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use inventory::{Def, ItemDef, Stack};
use rdev::{listen, Button, EventType, Key};
use serde::Serialize;
use steamworks::{AppId, Client};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

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

/// Which parts of the full-screen overlay take the mouse; everywhere else clicks go through.
#[derive(Default)]
struct Hit {
    /// (id, x, y, w, h) in window-relative CSS px
    rects: Vec<(String, f64, f64, f64, f64)>,
    /// (x, y, w, h) parts that take clicks; hover still goes by `rects`
    solid: Vec<(f64, f64, f64, f64)>,
    /// keep the mouse while something is dragged, even if the cursor outruns the rects
    hold: bool,
    hovered: Option<String>,
    passthrough: bool,
    /// last cursor position and the overlay's top-left corner, both in global logical px
    cursor: (f64, f64),
    origin: (f64, f64),
}

#[derive(Default)]
struct Shared {
    /// Set once Steam is up, which can be a while after start (see connect_steam).
    steam: OnceLock<Client>,
    art: OnceLock<PathBuf>,
    stats: Mutex<Option<Stats>>,
    notice: Mutex<Option<String>>,
    catalog: Mutex<Option<Vec<ItemDef>>>,
    stacks: Mutex<Option<Vec<Stack>>>,
    /// Serializes inventory changes so two clicks can't spend the same items.
    busy: Mutex<()>,
    ignore_mouse: AtomicBool,
    lobby: lobby::Lobby,
    hit: Mutex<Hit>,
}

type Sh<'a> = State<'a, Arc<Shared>>;

#[tauri::command]
fn get_art(state: Sh) -> Option<String> {
    state.art.get().map(|p| p.to_string_lossy().into_owned())
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

const CDN: &str = "https://pub-d6170922fa31462fa15463d240b18424.r2.dev/";

/// Bytes of a sprite on the game's item CDN (no CORS there, so the overlay can't read its
/// pixels itself). Only that CDN: the page can't use this to fetch anything else.
#[tauri::command]
async fn fetch_art(url: String) -> Result<tauri::ipc::Response, String> {
    if !url.starts_with(CDN) {
        return Err("not a CDN url".into());
    }
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut res = ureq::get(&url).call().map_err(|e| e.to_string())?;
        res.body_mut().read_to_vec().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
    .map(tauri::ipc::Response::new)
}

/// The overlay's hover boxes by id and its solid (click-taking) rects, window-relative CSS px;
/// `hold` while dragging.
#[tauri::command]
fn set_hit_rects(
    app: AppHandle,
    state: Sh,
    rects: Vec<(String, f64, f64, f64, f64)>,
    solid: Vec<(f64, f64, f64, f64)>,
    hold: bool,
) {
    {
        let mut hit = state.hit.lock().unwrap();
        hit.rects = rects;
        hit.solid = solid;
        hit.hold = hold;
    }
    // a box may have moved under a resting cursor
    update_hit(&app, &state.hit, None);
}

/// Turns click-through off only while the cursor is over a solid rect, and tells the overlay
/// what hover box it is in (CSS :hover can't see a click-through window). Runs on every global
/// mouse move (`cursor`) and when the rects change. Window calls go through the main thread, where
/// sync commands like set_hit_rects run too, so `hit` is never locked across them.
fn update_hit(app: &AppHandle, hit: &Mutex<Hit>, cursor: Option<(f64, f64)>) {
    let (passthrough, hovered) = {
        let mut hit = hit.lock().unwrap();
        if let Some(c) = cursor {
            hit.cursor = c;
        }
        let (x, y) = (hit.cursor.0 - hit.origin.0, hit.cursor.1 - hit.origin.1);
        let now = hit
            .rects
            .iter()
            .find(|r| x >= r.1 && x < r.1 + r.3 && y >= r.2 && y < r.2 + r.4)
            .map(|r| r.0.clone());
        let passthrough = !hit.hold
            && !hit
                .solid
                .iter()
                .any(|r| x >= r.0 && x < r.0 + r.2 && y >= r.1 && y < r.1 + r.3);
        let changed = (passthrough != hit.passthrough, now != hit.hovered);
        hit.passthrough = passthrough;
        hit.hovered = now.clone();
        (changed.0.then_some(passthrough), changed.1.then_some(now))
    };
    if let Some(p) = passthrough
        && let Some(w) = app.get_webview_window("main")
    {
        let _ = w.set_ignore_cursor_events(p);
    }
    if let Some(now) = hovered {
        let _ = app.emit_to("main", "hover", &now);
    }
}

/// Dev only: cursor (window px), rects and state of the click-through hit testing.
#[cfg(debug_assertions)]
#[tauri::command]
fn debug_hit(state: Sh) -> String {
    let hit = state.hit.lock().unwrap();
    format!(
        "cursor {:?} origin {:?} rects {:?} solid {} hold {} hovered {:?} passthrough {}",
        hit.cursor,
        hit.origin,
        hit.rects,
        hit.solid.len(),
        hit.hold,
        hit.hovered,
        hit.passthrough
    )
}

#[tauri::command]
fn open_menu(app: AppHandle) -> Result<(), String> {
    show_menu(&app, false).map_err(|e| e.to_string())
}

/// Opens a chest ("cosmetic" or "emote") for CHEST_PRICE taps, or for free when another
/// player gifted it (they paid). Returns the item won.
#[tauri::command]
async fn open_chest(app: AppHandle, kind: String, gift: Option<bool>) -> Result<Def, String> {
    let gift = gift.unwrap_or(false);
    blocking(app, move |app, sh| {
        let (recipe, token) = match kind.as_str() {
            "cosmetic" => (20, CHEST_TOKEN),
            "emote" => (34, EMOTE_CHEST_TOKEN),
            _ => return Err("unknown chest".into()),
        };
        if !gift && !affordable(sh) {
            return Err("Not enough taps".into());
        }
        let stacks = sh.stacks.lock().unwrap().clone().ok_or("Inventory not loaded yet")?;
        let mut inputs = Vec::new();
        for def in [token, ACHIEVEMENT_TOKEN, MANUAL_TOKEN] {
            inputs.extend(inventory::pick(&stacks, def, 1).ok_or("No chest token yet")?);
        }
        log::info!("open {kind} chest: recipe {recipe}, inputs {inputs:?}");
        let result = inventory::exchange(recipe, &inputs);
        exchanged(app, sh, &inputs, &result);
        let won = result?
            .iter()
            .map(|s| s.def)
            .find(|d| ![CHEST_TOKEN, EMOTE_CHEST_TOKEN, ACHIEVEMENT_TOKEN, MANUAL_TOKEN].contains(d))
            .ok_or("The chest was empty")?;
        // Like the game: taps are only spent once Steam confirmed the exchange.
        if !gift {
            spend(app, sh, CHEST_PRICE);
        }
        bump_stat(sh, "TotalItems");
        Ok(won)
    })
    .await
}

/// Pays CHEST_PRICE taps to open another player's ready chest ("cosmetic" or "emote") for them.
#[tauri::command]
async fn gift_chest(app: AppHandle, target: String, kind: String) -> Result<(), String> {
    blocking(app, move |app, sh| {
        let kind = match kind.as_str() {
            "cosmetic" => 0,
            "emote" => 1,
            _ => return Err("unknown chest".into()),
        };
        if !affordable(sh) {
            return Err("Not enough taps".into());
        }
        if !lobby::send_current(sh.steam.get().unwrap(), &sh.lobby, 4, &format!("{target}:{kind}")) {
            return Err("Not in a lobby".into());
        }
        spend(app, sh, CHEST_PRICE);
        Ok(())
    })
    .await
}

fn affordable(sh: &Shared) -> bool {
    sh.stats.lock().unwrap().as_ref().is_some_and(|s| s.score().current >= CHEST_PRICE)
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
            exchanged(app, sh, &inputs, &result);
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
        if sh.steam.get().is_none() {
            return Err("Steam not available".into());
        }
        let _guard = sh.busy.lock().unwrap();
        let r = f(&app, &sh);
        if let Err(e) = &r {
            log::warn!("command failed: {e}");
        }
        r
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
/// Updates our stacks from an exchange's own result. A GetAllItems right after can still return
/// the old items, and the next exchange would then send the helper tokens it just used up (fails).
fn exchanged(app: &AppHandle, sh: &Shared, inputs: &[(u64, u32)], result: &Result<Vec<Stack>, String>) {
    let Ok(items) = result else { return refresh(app, sh) };
    let now = {
        let mut stacks = sh.stacks.lock().unwrap();
        let Some(s) = stacks.as_mut() else { return };
        inventory::apply(s, inputs, items);
        owned(s)
    };
    let _ = app.emit("inventory", now);
}

fn refresh(app: &AppHandle, sh: &Shared) {
    match inventory::all_items() {
        Ok(stacks) => {
            log::info!("inventory loaded: {} stacks", stacks.len());
            let _ = app.emit("inventory", owned(&stacks));
            *sh.stacks.lock().unwrap() = Some(stacks);
        }
        Err(e) => log::warn!("inventory refresh failed: {e}"),
    }
}

fn spend(app: &AppHandle, sh: &Shared, amount: i32) {
    let mut stats = sh.stats.lock().unwrap();
    let Some(s) = stats.as_mut() else { return };
    s.minus = s.minus.saturating_add(amount).min(MAX_STAT);
    if let Some(c) = sh.steam.get() {
        let us = c.user_stats();
        let _ = us.set_stat_i32("BongoMinus", s.minus);
        let _ = us.store_stats();
    }
    let _ = app.emit("score", s.score());
}

fn bump_stat(sh: &Shared, name: &str) {
    if let Some(c) = sh.steam.get() {
        let us = c.user_stats();
        if let Ok(v) = us.get_stat_i32(name) {
            let _ = us.set_stat_i32(name, v.saturating_add(1));
            let _ = us.store_stats();
        }
    }
}

/// Shows (or with None clears) the overlay's notice.
fn notify(app: &AppHandle, shared: &Shared, msg: Option<String>) {
    if let Some(m) = &msg {
        log::info!("{m}");
    }
    *shared.notice.lock().unwrap() = msg.clone();
    let _ = app.emit("notice", msg);
}

/// macOS only shows another app's window over a fullscreen app if it is a non-activating
/// NSPanel that is a fullscreen auxiliary. So swap the window's class to an NSPanel subclass
/// (what tauri-nspanel does). `visibleOnAllWorkspaces` alone covers normal desktops only.
#[cfg(target_os = "macos")]
fn over_fullscreen(w: &tauri::WebviewWindow) {
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{ClassType, sel};
    use objc2_app_kit::{NSPanel, NSWindow, NSWindowCollectionBehavior as B, NSWindowStyleMask};
    use std::sync::OnceLock;
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    extern "C" fn yes(_: &AnyObject, _: Sel) -> Bool {
        Bool::YES
    }
    let class = CLASS.get_or_init(|| {
        let mut b = ClassBuilder::new(c"BongoCatBuddyPanel", NSPanel::class()).unwrap();
        // borderless panels can't take focus by default; the menu needs it (hides on blur)
        unsafe { b.add_method(sel!(canBecomeKeyWindow), yes as extern "C" fn(_, _) -> _) };
        // tao's window class has one pointer-sized ivar; the swap needs equal instance sizes
        b.add_ivar::<usize>(c"_tao_pad");
        b.register()
    });
    let Ok(p) = w.ns_window() else { return };
    let ns = unsafe { &*(p as *const NSWindow) };
    unsafe { AnyObject::set_class(ns.as_ref(), class) };
    ns.setStyleMask(ns.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    ns.setCollectionBehavior(ns.collectionBehavior() | B::CanJoinAllSpaces | B::FullScreenAuxiliary);
}

const PANEL: (f64, f64) = (380.0, 600.0);
/// When the panel last hid on blur. A tray click blurs it first, so that click must not reopen it.
static PANEL_HID: Mutex<Option<Instant>> = Mutex::new(None);

/// The menu is a panel hanging off the tray icon (above it when the tray is at the bottom,
/// like on Windows). It hides when it loses focus. `toggle`: a tray click, which also closes it.
fn show_menu(app: &AppHandle, toggle: bool) -> tauri::Result<()> {
    let w = match app.get_webview_window("menu") {
        Some(w) => w,
        None => {
            let w = WebviewWindowBuilder::new(app, "menu", WebviewUrl::App("index.html".into()))
                .title("BongoCatBuddy")
                .inner_size(PANEL.0, PANEL.1)
                .decorations(false)
                .transparent(true)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false)
                .build()?;
            #[cfg(target_os = "macos")]
            over_fullscreen(&w);
            let win = w.clone();
            w.on_window_event(move |e| {
                if let WindowEvent::Focused(false) = e {
                    *PANEL_HID.lock().unwrap() = Some(Instant::now());
                    let _ = win.hide();
                }
            });
            w
        }
    };
    if w.is_visible()? {
        return if toggle { w.hide() } else { w.set_focus() };
    }
    if toggle && PANEL_HID.lock().unwrap().is_some_and(|t| t.elapsed() < Duration::from_millis(300)) {
        return Ok(());
    }
    match app.tray_by_id("tray").and_then(|t| t.rect().ok().flatten()) {
        Some(r) => {
            let sf = w.scale_factor()?;
            let p = r.position.to_physical::<f64>(sf);
            let s = r.size.to_physical::<f64>(sf);
            let (pw, ph) = (PANEL.0 * sf, PANEL.1 * sf);
            let (mut x, mut y) = (p.x + s.width / 2.0 - pw / 2.0, p.y + s.height + 4.0 * sf);
            if let Some(m) = app.monitor_from_point(p.x, p.y)? {
                let (mp, ms) = (m.position(), m.size());
                if p.y > mp.y as f64 + ms.height as f64 / 2.0 {
                    y = p.y - ph - 4.0 * sf;
                }
                x = x.clamp(mp.x as f64 + 8.0 * sf, (mp.x + ms.width as i32) as f64 - pw - 8.0 * sf);
            }
            w.set_position(tauri::PhysicalPosition::new(x, y))?;
        }
        None => w.center()?,
    }
    w.show()?;
    w.set_focus()
}

const STARTING: &str = "Starting Steam…";

/// Opens a URL or folder with the OS default handler.
fn open_with_os(target: &std::ffi::OsStr) -> std::io::Result<std::process::Child> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(windows)]
    let cmd = "explorer";
    #[cfg(not(any(target_os = "macos", windows)))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd).arg(target).spawn()
}

/// Shows the log file in Finder / Explorer, so users can attach it to a bug report. Revealed, not
/// its folder opened: macOS takes the folder (`com.bongocatbuddy.app`) for an app bundle.
#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let file = dir.join(format!("{}.log", app.package_info().name));
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg("-R").arg(&file).spawn();
    #[cfg(windows)]
    let r = std::process::Command::new("explorer").arg(format!("/select,{}", file.display())).spawn();
    #[cfg(not(any(target_os = "macos", windows)))]
    let r = open_with_os(dir.as_os_str());
    r.map(|_| ()).map_err(|e| e.to_string())
}

/// Connects to Steam, starting it through the steam:// handler if it isn't running.
/// Runs on its own thread so the windows show while Steam boots.
fn connect_steam(app: &AppHandle, sh: &Shared) {
    let mut res = Client::init_app(APP_ID);
    if res.is_err() {
        if open_with_os("steam://".as_ref()).is_ok() {
            notify(app, sh, Some(STARTING.into()));
            for _ in 0..60 {
                thread::sleep(Duration::from_secs(2));
                res = Client::init_app(APP_ID);
                if res.is_ok() {
                    break;
                }
            }
        }
    }
    let client = match res {
        Ok(c) => c,
        Err(e) => return notify(app, sh, Some(format!("Steam not available: {e:?}"))),
    };
    // Clear "Starting Steam…", but not a notice that came in meanwhile.
    if sh.notice.lock().unwrap().as_deref() == Some(STARTING) {
        notify(app, sh, None);
    }
    let install = client.apps().app_install_dir(AppId(APP_ID));
    // ponytail: a window that already asked for art keeps the placeholder until restart
    if sh.art.get().is_none()
        && let Ok(data) = app.path().app_data_dir()
        && let Some(art) = art::ensure(&data, Some(install.as_str()).filter(|d| !d.is_empty()))
    {
        let _ = sh.art.set(art);
    }
    let _ = sh.steam.set(client);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Log file in the OS log folder (Settings > Show log file), also printed to stdout.
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |p| {
        log::error!("{p}");
        prev(p);
    }));
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(move |app| {
            // No Dock app: tray only, and its windows can float over other apps' fullscreen spaces.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let handle = app.handle().clone();
            let shared = Arc::new(Shared::default());
            if let Some(art) = art::ensure(&app.path().app_data_dir()?, None) {
                let _ = shared.art.set(art);
            }
            app.manage(shared.clone());
            let (h, sh) = (handle.clone(), shared.clone());
            thread::spawn(move || connect_steam(&h, &sh));

            let open = MenuItem::with_id(app, "menu", "Open menu", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&Menu::with_items(app, &[&open, &quit])?)
                // left click: the panel; right click: this menu
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        let _ = show_menu(tray.app_handle(), true);
                    }
                })
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "menu" => {
                        let _ = show_menu(app, false);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // The overlay covers the screen; it only takes the mouse over a cat (see update_hit).
            if let Some(w) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                over_fullscreen(&w);
                w.set_ignore_cursor_events(true)?;
                shared.hit.lock().unwrap().passthrough = true;
                // Cache where the overlay is, so mouse moves need no window calls.
                let origin = move |w: &tauri::WebviewWindow| -> Option<(f64, f64)> {
                    let p = w.outer_position().ok()?.to_logical::<f64>(w.scale_factor().ok()?);
                    Some((p.x, p.y))
                };
                shared.hit.lock().unwrap().origin = origin(&w).unwrap_or_default();
                let (win, sh) = (w.clone(), shared.clone());
                w.on_window_event(move |e| {
                    if matches!(e, WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. })
                        && let Some(o) = origin(&win)
                    {
                        sh.hit.lock().unwrap().origin = o;
                    }
                });
            }

            let taps = Arc::new(AtomicU32::new(0));
            spawn_input(handle.clone(), shared.clone(), taps.clone());
            #[cfg(debug_assertions)]
            devdriver::start(handle.clone());
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
            set_hit_rects,
            fetch_art,
            open_menu,
            open_chest,
            craft,
            use_emote,
            gift_chest,
            open_logs,
            lobby::get_lobby,
            lobby::lobby_create,
            lobby::lobby_join,
            lobby::lobby_join_id,
            lobby::lobby_join_random,
            lobby::lobby_list,
            lobby::lobby_leave,
            lobby::lobby_set_me,
            lobby::lobby_send,
            lobby::lobby_configure,
            lobby::lobby_friends,
            lobby::lobby_invite,
            #[cfg(debug_assertions)]
            debug_hit,
            #[cfg(debug_assertions)]
            devdriver::dev_reply
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let (RunEvent::Exit, Some(c)) = (event, app.state::<Arc<Shared>>().steam.get()) {
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
        let hook_app = app.clone();
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
            // ponytail: rdev reports macOS points, which match logical px; check units if Windows/Linux builds matter
            EventType::MouseMove { x, y } => update_hit(&hook_app, &sh.hit, Some((x, y))),
            // ends a native window drag, which the page itself never sees; payload: Alt held (no snapping)
            EventType::ButtonRelease(Button::Left) if sh.hit.lock().unwrap().hovered.is_some() => {
                let alt = held.contains(&Key::Alt) || held.contains(&Key::AltGr);
                let _ = hook_app.emit_to("main", "mouse-up", alt);
            }
            _ => {}
        });
        if let Err(e) = result {
            notify(
                &app,
                &shared,
                Some(format!("Can't read keys ({e:?}). Allow Input Monitoring/Accessibility, then restart.")),
            );
            // No global mouse events either: poll the cursor, slower, so the cats stay clickable.
            loop {
                thread::sleep(Duration::from_millis(100));
                let sf = app.get_webview_window("main").and_then(|w| w.scale_factor().ok());
                if let (Ok(p), Some(sf)) = (app.cursor_position(), sf) {
                    update_hit(&app, &shared.hit, Some((p.x / sf, p.y / sf)));
                }
            }
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

    let mut last_poll = Instant::now();
    let mut callbacks = None;

    loop {
        thread::sleep(TICK);
        let n = taps.swap(0, Ordering::Relaxed).min(MAX_STAT as u32) as i32;
        if n > 0 {
            let _ = app.emit("tap", n);
            pending = pending.saturating_add(n);
        }
        let Some(client) = sh.steam.get() else { continue };
        if callbacks.is_none() {
            callbacks = Some(lobby::register(client, &app));
            let (app, sh) = (app.clone(), sh.clone());
            thread::spawn(move || refresh(&app, &sh));
        }
        client.run_callbacks();
        lobby::tick(client, &app, &sh.lobby, n as u32, &mut last_poll);
        let us = client.user_stats();

        if sh.catalog.lock().unwrap().is_none()
            && let Some(defs) = inventory::definitions()
        {
            log::info!("item catalog loaded: {} definitions", defs.len());
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
            log::info!("steam stats loaded: BongoTap={tap} BongoBeat={beat} BongoMinus={minus}");
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
            log::info!("steam stats stored: BongoTap={} BongoBeat={}", s.tap, s.beat);
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
        Err(e) => log::warn!("inventory job failed: {e}"),
    });
}
