mod art;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use rdev::{listen, EventType};
use serde::Serialize;
use steamworks::{AppId, Client};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

const APP_ID: u32 = 3419430;
/// Same cap the game uses before an i32 stat would overflow.
const MAX_STAT: i32 = 2_147_483_646;
/// The game uploads stats once a minute.
const STORE_EVERY: Duration = Duration::from_secs(60);
const TICK: Duration = Duration::from_millis(16);

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

#[derive(Default)]
struct Shared {
    art: Option<PathBuf>,
    score: Mutex<Option<Score>>,
    notice: Mutex<Option<String>>,
}

#[tauri::command]
fn get_art(state: State<Arc<Shared>>) -> Option<String> {
    state.art.as_ref().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_score(state: State<Arc<Shared>>) -> Option<Score> {
    *state.score.lock().unwrap()
}

#[tauri::command]
fn get_notice(state: State<Arc<Shared>>) -> Option<String> {
    state.notice.lock().unwrap().clone()
}

fn notify(app: &AppHandle, shared: &Shared, msg: String) {
    eprintln!("{msg}");
    *shared.notice.lock().unwrap() = Some(msg.clone());
    let _ = app.emit("notice", msg);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let steam = Client::init_app(APP_ID);
    let exit_client = steam.as_ref().ok().cloned();

    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            let install_dir = steam
                .as_ref()
                .ok()
                .map(|c| c.apps().app_install_dir(AppId(APP_ID)))
                .filter(|d| !d.is_empty());
            let shared = Arc::new(Shared {
                art: art::ensure(&app.path().app_data_dir()?, install_dir.as_deref()),
                ..Default::default()
            });
            app.manage(shared.clone());

            let taps = Arc::new(AtomicU32::new(0));
            spawn_input(handle.clone(), shared.clone(), taps.clone());
            let client = match steam {
                Ok(c) => Some(c),
                Err(e) => {
                    notify(&handle, &shared, format!("Steam not available: {e:?}"));
                    None
                }
            };
            thread::spawn(move || main_loop(handle, shared, client, taps));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_art, get_score, get_notice])
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
        let result = listen(move |e| match e.event_type {
            EventType::KeyPress(k) if held.insert(k) => {
                taps.fetch_add(1, Ordering::Relaxed);
            }
            EventType::KeyRelease(k) => {
                held.remove(&k);
            }
            EventType::ButtonPress(_) => {
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

/// Pumps Steam callbacks, turns counted presses into taps and keeps the stats in sync.
fn main_loop(app: AppHandle, shared: Arc<Shared>, client: Option<Client>, taps: Arc<AtomicU32>) {
    let mut stats: Option<Stats> = None;
    let mut pending: i32 = 0;
    let mut last_store = Instant::now();
    loop {
        thread::sleep(TICK);
        let n = taps.swap(0, Ordering::Relaxed).min(MAX_STAT as u32) as i32;
        if n > 0 {
            let _ = app.emit("tap", n);
            pending = pending.saturating_add(n);
        }
        let Some(client) = &client else { continue };
        client.run_callbacks();
        let us = client.user_stats();

        // Stats arrive shortly after init; taps made before that are kept in `pending`.
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
            stats = Some(Stats { tap: tap.max(minus), beat, minus });
            changed = true;
        }
        let s = stats.as_mut().unwrap();

        if changed {
            s.tap = s.tap.saturating_add(pending).min(MAX_STAT);
            s.beat = s.beat.saturating_add(pending).min(MAX_STAT);
            pending = 0;
            let _ = us.set_stat_i32("BongoTap", s.tap);
            let _ = us.set_stat_i32("BongoBeat", s.beat);
            let score = s.score();
            *shared.score.lock().unwrap() = Some(score);
            let _ = app.emit("score", score);
        }
        if last_store.elapsed() >= STORE_EVERY {
            let _ = us.store_stats();
            eprintln!("steam stats stored: BongoTap={} BongoBeat={}", s.tap, s.beat);
            last_store = Instant::now();
        }
    }
}
