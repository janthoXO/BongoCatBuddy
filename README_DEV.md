# Development

Direction: a clean, minimal alternative client for the game, not a second gamified one. It keeps the important features, stays wire-compatible, and stays light. New features go through that filter (see "Look").

Rust own Steam. React draw cat. Tauri glue.

## Setup

Need:
- Rust stable
- Node 26 + pnpm
- Steam running, game (app 3419430) owned. Installed too, for art.
- macOS: Xcode Command Line Tools
- Windows: WebView2 + MSVC build tools. See <https://tauri.app/start/prerequisites/>

```sh
pnpm install
pnpm tauri dev        # run app
pnpm tauri build      # bundle
cd src-tauri && cargo test   # art test skips if game not installed
```

Version lives in `package.json`; `tauri.conf.json` reads it.

## Layout

`src-tauri/src/`
- `main.rs` - entry, calls `bongo_cat_buddy_lib::run()`.
- `lib.rs` - Tauri commands, tray, windows, global input (rdev), click-through hit testing, main loop (Steam callbacks, taps to stats, lobby tick).
- `lobby.rs` - Steam lobbies, wired like the game so both clients see each other.
- `inventory.rs` - blocking wrapper around ISteamInventory (not in steamworks crate).
- `art.rs` - copies cat sprites out of the local game install.
- `devdriver.rs` - debug-only remote control.

`src/`
- `main.tsx` - routes by window label: `menu` -> `Menu`, else `Overlay`.
- `overlay/` - `Overlay.tsx`, `RemoteCat.tsx`, `Chest.tsx`. Transparent cat window.
- `menu/` - `Menu.tsx` tabs: `Inventory`, `Crafting`, `Lobby`, `Settings`. Window `menu` is a tray panel (380x600, no decorations), see below.
- `lib/` - `prefs.ts` (settings, saved in localStorage, broadcast to all windows by "prefs" event), `lobby.ts` (protocol, channels), `items.ts`.
- `components/` - `CatFigure.tsx`, `EmoteParticle.tsx`, `ui/` (shadcn).

## Steam

- `connect_steam` on own thread: `Client::init_app(3419430)`. Fail = open `steam://`, retry every 2 s up to 2 min, notice "Starting Steam…". Windows show before. `Shared.steam` / `Shared.art` are `OnceLock`, empty until connect. Main loop register callbacks + load inventory on first tick with client.
- `build.rs` copies Steam runtime lib (`libsteam_api.dylib` / `steam_api64.dll`; `libsteam_api.so` on Linux) from `steamworks-sys` crate sources (version from `Cargo.lock`) into `target/<profile>/`, next to the binary.
- `tauri.conf.json` bundles it into macOS app: `Contents/MacOS/libsteam_api.dylib`.
- `tauri.windows.conf.json` bundles `steam_api64.dll` next to the exe.
- Main loop pumps Steam callbacks and lobby tick. Stats uploaded about once a minute like the game.

## Look

Minimal, system-like, not gamified. Tokens in `src/index.css`: system font, neutral grays, system blue. Light/dark follows the OS (`prefers-color-scheme`; the `dark:` variant is that media query, no class). Overlay chrome (score, name tags, bubbles, small buttons) uses the `pill` utility. Settings stay few: what can be a direct interaction is one (click cat = score bar, right-click = menu, emote bar only when emotes are picked, chests only while you hold a token of that kind (Steam's playtime generator drops them)). Menu is a narrow tray panel, so UI must fit 380 px wide..

## Menu panel

`show_menu` in `lib.rs`. Left click on tray icon toggles the panel, hung below the icon (above it when the tray sits in the bottom half, like Windows taskbar). Right click on tray = Open menu / Quit. Right click on a cat (`open_menu`) opens it too. Hides on blur and on Escape. A tray click blurs the open panel first, so a click within 300 ms of that blur does not reopen it (`PANEL_HID`).

## Overlay and input

- One transparent always-on-top window `main`. Size = bounding box of all cats + 24 px padding (`PAD` in `Overlay.tsx`).
- Click-through by default (`set_ignore_cursor_events`). Rust gets global mouse moves from rdev. Frontend reports with `set_hit_rects`: `[data-hit]` boxes (hover, ours first) and `solid` rects (`hold` = true while dragging). `update_hit` turns click-through off only when cursor is over a solid rect.
- Solid = opaque pixels of each cat sprite + buttons/inputs. `src/lib/mask.ts`: sprite drawn to 32x32 canvas, alpha cells merged to rects, LRU cache of 64 masks, fetched on demand. Item CDN has no CORS, so Rust `fetch_art` (ureq, CDN urls only) gives the bytes. Mask not ready or unreadable = whole sprite square.
- Events to frontend: `hover` (id of hovered rect or null; CSS `:hover` cannot see click-through window), `mouse-up` (left release while hovering; page never sees it during native drag).
- No rdev (macOS permission missing): `spawn_input` polls cursor every 100 ms instead, shows a notice.
- Drag:
  - Own cat alone or row/column layout: whole window drags natively (`startDragging`). Position saved on rdev mouse-up.
  - Free layout: window stretched to screen during drag, then shrunk.
  - Snap (PowerPoint-style, `snap` in `Overlay.tsx`): box onto screen edges/center, cat art onto other cats' edges/centers, within 8 px. Free drags snap live; native drags snap on release (screen only). Alt/Option held = no snap (`mouse-up` payload carries Alt for native drags).
- Why: moving window left/top edge while webview repaints makes cats jump 1-2 frames on macOS (measured). Native drag avoids it.
- Why small window: full-screen transparent window costs graphics memory.

| Window | Total (dev build) |
|---|---|
| Full-screen | ~330 MB |
| Box around cats | ~118 MB (app 40 + WebContent 62 + GPU 16) |

Gotcha: Tauri sync commands run on main thread. Never hold a mutex across window getters/setters. Deadlock. (`update_hit` copies state out of the lock first.)

## Multiplayer protocol

Compatible with the real game. Source: `lobby.rs`, `src/lib/lobby.ts`.

Lobby data:

| Key | Value |
|---|---|
| `LOBBY_NAME` | name |
| `LOBBYCODE` | custom code, 5-12 chars |
| `PRIVATE_LOBBY` | 0 private, 1 friends, 2 public |
| `z_heathenMode` | `"General"` |
| `LobbyClosed` | set = closed, hidden from list |
| `z_heathenKick` | list of kicked ids; if it contains us, we leave |

Member data: `hat`, `skin`, `bongos` (item id, -1 none), `chest_ready`, `emote_chest_ready` (`"true"`/`"false"`).

Chat: UTF-8 JSON `{"Channel":n,"Message":"..."}`.

| Channel | Meaning | Message |
|---|---|---|
| 2 | taps | count since last message |
| 3 | speech | text (max 100 chars in UI) |
| 4 | open chest | `target:0\|1` (0 cosmetic, 1 emote). Sender paid 1000 taps, receiver opens ready chest free |
| 5 | got item | item def id |
| 6 | emote | emote def id |
| 7 | reset leaderboard | - |
| 8 | pat | `target` steam id |

Rest:
- Lobby code = base59 of lobby id, alphabet `0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`. Or custom `LOBBYCODE`.
- Random join widens distance filter `Default` -> `Far` -> `Worldwide`, needs 1 open slot.
- Public list: Steam caps a lobby list at 50 and has no offset. Next page = same request with `LOBBY_NAME` `NotEqual` every name already shown. Only one list request at a time (a second cancels the first), so `list_lobbies` holds a lock.
- Max 250 members.
- Rich presence `connect` = raw lobby id (friends join via Steam).
- Members polled every 500 ms. Reason: steamworks 0.13 `LobbyChatUpdate` callback panics on combined flags.

### Joining from Steam

Buddy runs as app 3419430, so Steam treats it as the game. Tested on macOS (issue #7):

| Case | What happens |
|---|---|
| Buddy running, game not | Invite / `steam://joinlobby/3419430/<lobby>/<user>` arrive in Buddy as `GameLobbyJoinRequested`. Friends list "Join game" uses our rich presence `connect` and arrives as `GameRichPresenceJoinRequested`. Both go to `join_later` in `lobby.rs`. Works. |
| Buddy running, user starts game | Steam refuses: `LaunchApp ... WaitingPrevProcess`, then `AppError_16`. Game cannot start while Buddy runs. |
| Nothing running | Steam starts the real game with `+connect_lobby <id>`. Buddy cannot catch this, no hook for `steam://` links. |
| Game running, then Buddy | Not tested (game would not launch on the test Mac). Unknown who gets the callback. |

steamworks 0.13 wraps both callbacks, so no raw `sys` needed.

## Dev driver

Debug builds only (`devdriver.rs`). TCP on `127.0.0.1:7311`. Text before tab = window label (`main` or `menu`); after tab = body of async JS function run in that window. Return value (or error) written back.

```sh
printf 'main\treturn document.title' | nc 127.0.0.1 7311
```

## CI and release

Workflows in `.github/workflows/`:
- `build.yml` - on PRs: typecheck + build frontend, `cargo test`.
- `package.yml` - on PRs touching `src-tauri/` (any base, so stacked PRs get checked too), and reusable (`workflow_call`, input `version`). `tauri build` on `macos-latest` (arm64 -> dmg) and `windows-latest` (NSIS setup exe). Uploaded as artifacts.
- `release.yml` - on push of tag `v*` or push to `main`. Version = tag, else latest release with patch + 1 (`.github/actions/determine-version`). Then package, GitHub Release with generated notes, then update `Casks/bongocatbuddy.rb` (version + sha256) on `main`.

## Conventions

- One branch per milestone. Stacked PRs via `gh stack`.
- Commit messages in caveman voice.
