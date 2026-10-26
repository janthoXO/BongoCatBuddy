//! Steam lobbies, wired exactly like the game so both clients see each other:
//! lobby data `LOBBY_NAME`, `LOBBYCODE`, `PRIVATE_LOBBY`, `z_heathenMode`, member data
//! `hat`, `skin`, `chest_ready`, `emote_chest_ready`, and chat messages that are UTF-8
//! JSON `{"Channel":n,"Message":"..."}`.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use steamworks::{
    CallbackHandle, Client, DistanceFilter, FriendFlags, FriendState, GameLobbyJoinRequested,
    GameRichPresenceJoinRequested, LobbyChatMsg, LobbyDataUpdate, LobbyId, LobbyKey, LobbyListFilter, LobbyType,
    PersonaStateChange, SteamId, StringFilter, StringFilterKind,
};
use steamworks_sys as sys;
use tauri::{AppHandle, Emitter, Manager};

use crate::Shared;

const MAX_MEMBERS: u32 = 250;
const TIMEOUT: Duration = Duration::from_secs(15);
const MEMBER_POLL: Duration = Duration::from_millis(500);
/// Chat channels: 2 taps, 3 speech, 4 open chest for "<steamid>:<0 cosmetic|1 emote>",
/// 5 got item, 6 emote, 7 reset leaderboard, 8 pat "<steamid>".
const CH_TAPS: i32 = 2;
/// The game drops a frame's taps instead of sending 8 or more.
const MAX_TAPS_PER_MSG: u32 = 7;

const BASE59: &[u8] = b"0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/// Lobby id <-> the short code the game shows.
fn encode(mut n: u64) -> String {
    let mut out = Vec::new();
    while n != 0 {
        out.push(BASE59[(n % 59) as usize]);
        n /= 59;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

fn decode(s: &str) -> Option<u64> {
    s.bytes().try_fold(0u64, |n, b| {
        let d = BASE59.iter().position(|&c| c == b)? as u64;
        n.checked_mul(59)?.checked_add(d)
    })
}

#[derive(Default)]
pub struct Lobby {
    current: Mutex<Option<LobbyId>>,
    /// Our member data, applied to every lobby we enter.
    me: Mutex<BTreeMap<String, String>>,
    members: Mutex<Vec<SteamId>>,
    dirty: AtomicBool,
}

impl Lobby {
    fn current(&self) -> Option<LobbyId> {
        *self.current.lock().unwrap()
    }
}

#[derive(Serialize, Clone)]
pub struct Member {
    id: String,
    name: String,
    hat: Option<i32>,
    skin: Option<i32>,
    chest_ready: bool,
    emote_chest_ready: bool,
}

#[derive(Serialize, Clone)]
pub struct State {
    id: String,
    code: String,
    name: String,
    /// 0 private, 1 friends only, 2 public
    visibility: u8,
    owner: bool,
    me: String,
    members: Vec<Member>,
}

#[derive(Serialize)]
pub struct Listed {
    id: String,
    name: String,
    members: usize,
    max: usize,
}

#[derive(Serialize)]
pub struct Friend {
    id: String,
    name: String,
    /// playing the game (or this client) right now
    in_game: bool,
}

#[derive(Serialize, Deserialize)]
struct Wire {
    #[serde(rename = "Channel")]
    channel: i32,
    #[serde(rename = "Message")]
    message: String,
}

#[derive(Serialize, Clone)]
struct Msg {
    from: String,
    channel: i32,
    message: String,
}

/// Starts an async Steam call and waits for its result (delivered by the main loop's run_callbacks).
fn wait<T: Send + 'static>(start: impl FnOnce(mpsc::Sender<T>)) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    start(tx);
    rx.recv_timeout(TIMEOUT).map_err(|_| "Steam didn't answer".to_string())
}

fn data(c: &Client, id: LobbyId, key: &str) -> Option<String> {
    c.matchmaking().lobby_data(id, key).filter(|v| !v.is_empty())
}

fn member_data(c: &Client, id: LobbyId, user: SteamId, key: &str) -> Option<String> {
    c.matchmaking().get_lobby_member_data(id, user, key).filter(|v| !v.is_empty())
}

fn code(c: &Client, id: LobbyId) -> String {
    data(c, id, "LOBBYCODE").unwrap_or_else(|| encode(id.raw()))
}

fn lobby_type(visibility: u8) -> Result<LobbyType, String> {
    Ok(match visibility {
        0 => LobbyType::Private,
        1 => LobbyType::FriendsOnly,
        2 => LobbyType::Public,
        _ => return Err("unknown visibility".into()),
    })
}

fn state(c: &Client, lobby: &Lobby) -> Option<State> {
    let id = lobby.current()?;
    let mm = c.matchmaking();
    let me = c.user().steam_id();
    let flag = |u, k| member_data(c, id, u, k).as_deref() == Some("true");
    let num = |u, k| member_data(c, id, u, k).and_then(|v| v.parse().ok()).filter(|&v: &i32| v >= 0);
    Some(State {
        id: id.raw().to_string(),
        code: code(c, id),
        name: data(c, id, "LOBBY_NAME").unwrap_or_default(),
        visibility: data(c, id, "PRIVATE_LOBBY").and_then(|v| v.parse().ok()).unwrap_or(0),
        owner: mm.lobby_owner(id) == me,
        me: me.raw().to_string(),
        members: mm
            .lobby_members(id)
            .into_iter()
            .map(|u| Member {
                id: u.raw().to_string(),
                name: c.friends().get_friend(u).name(),
                hat: num(u, "hat"),
                skin: num(u, "skin"),
                chest_ready: flag(u, "chest_ready"),
                emote_chest_ready: flag(u, "emote_chest_ready"),
            })
            .collect(),
    })
}

fn list_lobbies(c: &Client, filter: LobbyListFilter) -> Result<Vec<LobbyId>, String> {
    // Steam runs one list request at a time: a second one cancels the first, which then never answers.
    static ONE: Mutex<()> = Mutex::new(());
    let _one = ONE.lock().unwrap();
    let mm = c.matchmaking();
    mm.set_lobby_list_filter(filter);
    wait(|tx| {
        mm.request_lobby_list(move |r| {
            let _ = tx.send(r);
        })
    })?
    .map_err(|e| e.to_string())
}

fn by_distance(distance: DistanceFilter) -> LobbyListFilter<'static> {
    LobbyListFilter::default().set_distance(Some(distance))
}

/// Resolves what the player typed: a custom lobby code, or the encoded lobby id.
fn find(c: &Client, code: &str) -> Result<LobbyId, String> {
    let code = code.trim();
    if code.len() < 5 {
        return Err("Lobby codes have at least 5 characters".into());
    }
    let custom = by_distance(DistanceFilter::Worldwide).set_string(Some(vec![StringFilter(
        LobbyKey::new("LOBBYCODE"),
        code,
        StringFilterKind::Equal,
    )]));
    if let Some(&id) = list_lobbies(c, custom)?.first() {
        return Ok(id);
    }
    decode(code).map(LobbyId::from_raw).ok_or_else(|| "No lobby with that code".into())
}

fn leave_current(c: &Client, lobby: &Lobby) {
    if let Some(id) = lobby.current.lock().unwrap().take() {
        c.matchmaking().leave_lobby(id);
        c.friends().clear_rich_presence();
        lobby.dirty.store(true, Ordering::Relaxed);
    }
}

fn join(c: &Client, lobby: &Lobby, id: LobbyId) -> Result<(), String> {
    if lobby.current() == Some(id) {
        return Ok(());
    }
    leave_current(c, lobby);
    let mm = c.matchmaking();
    wait(|tx| {
        mm.join_lobby(id, move |r| {
            let _ = tx.send(r);
        })
    })?
    .map_err(|_| "Couldn't join that lobby".to_string())?;
    // Same checks as the game: the owner can close a lobby or kick-list players.
    let me = format!("[{}]", c.user().steam_id().raw());
    if data(c, id, "LobbyClosed").is_some() || data(c, id, "z_heathenKick").is_some_and(|k| k.contains(&me)) {
        mm.leave_lobby(id);
        return Err("That lobby is closed".into());
    }
    entered(c, lobby, id);
    Ok(())
}

fn entered(c: &Client, lobby: &Lobby, id: LobbyId) {
    *lobby.current.lock().unwrap() = Some(id);
    for (k, v) in lobby.me.lock().unwrap().iter() {
        c.matchmaking().set_lobby_member_data(id, k, v);
    }
    // Lets friends join from their Steam friends list.
    let raw = id.raw().to_string();
    c.friends().set_rich_presence("connect", Some(&raw));
    c.friends().set_rich_presence("steam_player_group", Some(&raw));
    lobby.members.lock().unwrap().clear();
    lobby.dirty.store(true, Ordering::Relaxed);
}

/// Joins in the background (for Steam invites, which arrive inside a callback).
fn join_later(app: &AppHandle, id: LobbyId) {
    let app = app.clone();
    thread::spawn(move || {
        let sh = app.state::<Arc<Shared>>();
        if let Some(c) = sh.steam.get()
            && let Err(e) = join(c, &sh.lobby, id)
        {
            let _ = app.emit("lobby-error", e);
        }
    });
}

/// Hooks up the lobby callbacks. Keep the handles alive for as long as they should fire.
pub fn register(c: &Client, app: &AppHandle) -> Vec<CallbackHandle> {
    let sh = || app.state::<Arc<Shared>>().inner().clone();
    let (a, s, cc) = (app.clone(), sh(), c.clone());
    let chat = c.register_callback(move |m: LobbyChatMsg| {
        if s.lobby.current() != Some(m.lobby) || m.user == cc.user().steam_id() {
            return;
        }
        let mut buf = [0u8; 4096];
        let raw = cc.matchmaking().get_lobby_chat_entry(m.lobby, m.chat_id, &mut buf);
        let text = String::from_utf8_lossy(raw);
        if let Ok(w) = serde_json::from_str::<Wire>(text.trim_end_matches('\0')) {
            let _ = a.emit("lobby-msg", Msg { from: m.user.raw().to_string(), channel: w.channel, message: w.message });
        }
    });
    let s = sh();
    let data = c.register_callback(move |u: LobbyDataUpdate| {
        if s.lobby.current() == Some(u.lobby) {
            s.lobby.dirty.store(true, Ordering::Relaxed);
        }
    });
    let s = sh();
    let persona = c.register_callback(move |p: PersonaStateChange| {
        if s.lobby.members.lock().unwrap().contains(&p.steam_id) {
            s.lobby.dirty.store(true, Ordering::Relaxed);
        }
    });
    let a = app.clone();
    let invite = c.register_callback(move |r: GameLobbyJoinRequested| join_later(&a, r.lobby_steam_id));
    let a = app.clone();
    let presence = c.register_callback(move |r: GameRichPresenceJoinRequested| {
        if let Ok(id) = r.connect.trim().parse() {
            join_later(&a, LobbyId::from_raw(id));
        }
    });
    vec![chat, data, persona, invite, presence]
}

/// Called every main loop tick: forwards our taps and publishes lobby changes.
pub fn tick(c: &Client, app: &AppHandle, lobby: &Lobby, taps: u32, last_poll: &mut Instant) {
    if let Some(id) = lobby.current() {
        if taps > 0 {
            send(c, id, CH_TAPS, &taps.min(MAX_TAPS_PER_MSG).to_string());
        }
        // Joins and leaves (LobbyChatUpdate panics in the crate on combined flags, so poll).
        if last_poll.elapsed() >= MEMBER_POLL {
            *last_poll = Instant::now();
            let now = c.matchmaking().lobby_members(id);
            let mut was = lobby.members.lock().unwrap();
            if *was != now {
                c.friends().set_rich_presence("steam_player_group_size", Some(&now.len().to_string()));
                *was = now;
                lobby.dirty.store(true, Ordering::Relaxed);
            }
        }
    }
    if lobby.dirty.swap(false, Ordering::Relaxed) {
        let _ = app.emit("lobby", state(c, lobby));
    }
}

fn send(c: &Client, id: LobbyId, channel: i32, message: &str) -> bool {
    let json = serde_json::to_string(&Wire { channel, message: message.into() }).unwrap();
    c.matchmaking().send_lobby_chat_message(id, json.as_bytes()).is_ok()
}

/// Sends a chat message to the current lobby. Returns false when not in one.
pub fn send_current(c: &Client, lobby: &Lobby, channel: i32, message: &str) -> bool {
    lobby.current().is_some_and(|id| send(c, id, channel, message))
}

/// Runs a lobby operation off the async runtime; it may wait on Steam.
async fn run<T: Send + 'static>(
    app: AppHandle,
    f: impl FnOnce(&Client, &Lobby) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sh = app.state::<Arc<Shared>>();
        let c = sh.steam.get().ok_or("Steam not available")?;
        f(c, &sh.lobby)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_lobby(app: AppHandle) -> Result<Option<State>, String> {
    run(app, |c, l| Ok(state(c, l))).await
}

/// Creates a lobby (visibility 0 private, 1 friends, 2 public), optionally under a custom code.
#[tauri::command]
pub async fn lobby_create(app: AppHandle, visibility: u8, code: Option<String>) -> Result<(), String> {
    run(app, move |c, l| {
        let ty = lobby_type(visibility)?;
        let code = code.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        if let Some(code) = &code {
            if !(5..=12).contains(&code.len()) {
                return Err("Lobby codes have 5 to 12 characters".into());
            }
            let taken = by_distance(DistanceFilter::Worldwide).set_string(Some(vec![StringFilter(
                LobbyKey::new("LOBBYCODE"),
                code,
                StringFilterKind::Equal,
            )]));
            if !list_lobbies(c, taken)?.is_empty() {
                return Err("That code is taken".into());
            }
        }
        leave_current(c, l);
        let mm = c.matchmaking();
        let id = wait(|tx| {
            mm.create_lobby(ty, MAX_MEMBERS, move |r| {
                let _ = tx.send(r);
            })
        })?
        .map_err(|e| e.to_string())?;
        mm.set_lobby_data(id, "PRIVATE_LOBBY", &visibility.to_string());
        mm.set_lobby_data(id, "z_heathenMode", "General");
        mm.set_lobby_data(id, "LOBBY_NAME", &format!("{}'s Lobby", c.friends().name()));
        if let Some(code) = &code {
            mm.set_lobby_data(id, "LOBBYCODE", code);
        }
        entered(c, l, id);
        Ok(())
    })
    .await
}

/// Joins by lobby code (custom code or encoded id).
#[tauri::command]
pub async fn lobby_join(app: AppHandle, code: String) -> Result<(), String> {
    run(app, move |c, l| join(c, l, find(c, &code)?)).await
}

/// Joins a lobby from the list by its raw id.
#[tauri::command]
pub async fn lobby_join_id(app: AppHandle, id: String) -> Result<(), String> {
    run(app, move |c, l| join(c, l, LobbyId::from_raw(id.parse().map_err(|_| "bad lobby id")?))).await
}

/// Joins a random open lobby, widening the search like the game does.
#[tauri::command]
pub async fn lobby_join_random(app: AppHandle) -> Result<(), String> {
    run(app, |c, l| {
        for d in [DistanceFilter::Default, DistanceFilter::Far, DistanceFilter::Worldwide] {
            let found = list_lobbies(c, by_distance(d).set_open_slots(Some(1)))?;
            if !found.is_empty() {
                let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().subsec_nanos();
                return join(c, l, found[nanos as usize % found.len()]);
            }
        }
        Err("No open lobbies right now".into())
    })
    .await
}

/// Steam hands out at most this many lobbies per request, whatever count we ask for.
const PAGE: usize = 50;

#[derive(Serialize)]
pub struct LobbyPage {
    lobbies: Vec<Listed>,
    /// Steam gave a full page, so asking again with these names skipped may find more.
    more: bool,
}

/// Public lobbies worldwide, fullest first. Steam has no offset and caps a list at 50, so the
/// next page is the same request with every lobby name seen so far filtered out.
// ponytail: a lobby named like one already seen never shows up; fine while names are mostly "<name>'s Lobby"
#[tauri::command]
pub async fn lobby_list(app: AppHandle, skip: Vec<String>) -> Result<LobbyPage, String> {
    run(app, move |c, _| {
        let mm = c.matchmaking();
        let not = skip.iter().map(|n| StringFilter(LobbyKey::new("LOBBY_NAME"), n, StringFilterKind::NotEqual)).collect();
        let found = list_lobbies(c, by_distance(DistanceFilter::Worldwide).set_string(Some(not)))?;
        let more = found.len() >= PAGE;
        let mut out: Vec<Listed> = found
            .into_iter()
            .filter(|&id| data(c, id, "LobbyClosed").is_none())
            .map(|id| Listed {
                id: id.raw().to_string(),
                name: data(c, id, "LOBBY_NAME").unwrap_or_default(),
                members: mm.lobby_member_count(id),
                max: mm.lobby_member_limit(id).unwrap_or(MAX_MEMBERS as usize),
            })
            .collect();
        out.sort_by_key(|l| std::cmp::Reverse(l.members));
        Ok(LobbyPage { lobbies: out, more })
    })
    .await
}

#[tauri::command]
pub async fn lobby_leave(app: AppHandle) -> Result<(), String> {
    run(app, |c, l| Ok(leave_current(c, l))).await
}

/// Sets our member data (`hat`, `skin`, `chest_ready`, ...) now and for later lobbies.
#[tauri::command]
pub async fn lobby_set_me(app: AppHandle, data: BTreeMap<String, String>) -> Result<(), String> {
    run(app, move |c, l| {
        let id = l.current();
        let mut me = l.me.lock().unwrap();
        for (k, v) in data {
            if let Some(id) = id
                && me.get(&k) != Some(&v)
            {
                c.matchmaking().set_lobby_member_data(id, &k, &v);
            }
            me.insert(k, v);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn lobby_send(app: AppHandle, channel: i32, message: String) -> Result<bool, String> {
    run(app, move |c, l| Ok(send_current(c, l, channel, &message))).await
}

/// Owner only: lobby name and visibility.
#[tauri::command]
pub async fn lobby_configure(app: AppHandle, name: Option<String>, visibility: Option<u8>) -> Result<(), String> {
    run(app, move |c, l| {
        let id = l.current().ok_or("Not in a lobby")?;
        let mm = c.matchmaking();
        if mm.lobby_owner(id) != c.user().steam_id() {
            return Err("Only the lobby owner can change that".into());
        }
        if let Some(name) = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()) {
            mm.set_lobby_data(id, "LOBBY_NAME", &name);
        }
        if let Some(v) = visibility {
            let ty = match lobby_type(v)? {
                LobbyType::Private => sys::ELobbyType::k_ELobbyTypePrivate,
                LobbyType::FriendsOnly => sys::ELobbyType::k_ELobbyTypeFriendsOnly,
                _ => sys::ELobbyType::k_ELobbyTypePublic,
            };
            // not wrapped by the steamworks crate
            unsafe {
                sys::SteamAPI_ISteamMatchmaking_SetLobbyType(sys::SteamAPI_SteamMatchmaking_v009(), id.raw(), ty)
            };
            mm.set_lobby_data(id, "PRIVATE_LOBBY", &v.to_string());
        }
        Ok(())
    })
    .await
}

/// Online friends, the ones playing first.
#[tauri::command]
pub async fn lobby_friends(app: AppHandle) -> Result<Vec<Friend>, String> {
    run(app, |c, _| {
        let app_id = c.utils().app_id();
        let mut out: Vec<Friend> = c
            .friends()
            .get_friends(FriendFlags::IMMEDIATE)
            .into_iter()
            .filter(|f| f.state() != FriendState::Offline)
            .map(|f| Friend {
                id: f.id().raw().to_string(),
                name: f.name(),
                in_game: f.game_played().is_some_and(|g| g.game.app_id() == app_id),
            })
            .collect();
        out.sort_by_key(|f| (!f.in_game, f.name.to_lowercase()));
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn lobby_invite(app: AppHandle, friend: String) -> Result<(), String> {
    run(app, move |_, l| {
        let id = l.current().ok_or("Not in a lobby")?;
        let friend: u64 = friend.parse().map_err(|_| "bad friend id")?;
        // not wrapped by the steamworks crate
        let ok = unsafe {
            sys::SteamAPI_ISteamMatchmaking_InviteUserToLobby(sys::SteamAPI_SteamMatchmaking_v009(), id.raw(), friend)
        };
        if ok { Ok(()) } else { Err("Steam refused the invite".into()) }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base59_roundtrip() {
        // an id shaped like a real lobby id
        let id = 109775243415879337;
        assert_eq!(decode(&encode(id)), Some(id));
        assert_eq!(decode("0I"), None); // 'I' isn't in the alphabet
        assert_eq!(decode("zzzzzzzzzzzzzzzzzzzz"), None); // overflow
    }
}
