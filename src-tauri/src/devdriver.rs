//! Dev-build-only remote control, so the UI can be exercised from a shell:
//!
//!   printf 'menu\treturn document.title' | nc 127.0.0.1 7311
//!
//! The text after the tab is the body of an async JS function run in that window
//! ("main" or "menu"); its return value (or error) is written back to the socket.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

static REPLY: Mutex<Option<Sender<String>>> = Mutex::new(None);

#[tauri::command]
pub fn dev_reply(msg: String) {
    if let Some(tx) = REPLY.lock().unwrap().as_ref() {
        let _ = tx.send(msg);
    }
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let Ok(listener) = TcpListener::bind("127.0.0.1:7311") else { return };
        for mut stream in listener.incoming().flatten() {
            let mut input = String::new();
            let _ = stream.read_to_string(&mut input);
            let (label, body) = input.split_once('\t').unwrap_or(("main", &input));
            let reply = match app.get_webview_window(label.trim()) {
                None => format!("no window {label}"),
                Some(w) => {
                    let (tx, rx) = channel();
                    *REPLY.lock().unwrap() = Some(tx);
                    let js = format!(
                        "(async () => {{ let r; try {{ r = await (async () => {{ {body} }})(); \
                         r = typeof r === 'string' ? r : JSON.stringify(r); }} catch (e) {{ r = 'ERR ' + e; }} \
                         window.__TAURI_INTERNALS__.invoke('dev_reply', {{ msg: String(r) }}); }})()"
                    );
                    match w.eval(&js) {
                        Err(e) => format!("eval failed: {e}"),
                        Ok(()) => rx.recv_timeout(Duration::from_secs(20)).unwrap_or_else(|_| "timeout".into()),
                    }
                }
            };
            let _ = stream.write_all(reply.as_bytes());
        }
    });
}
