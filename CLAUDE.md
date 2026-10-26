# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Tauri 2 desktop app: a Bongo Cat overlay that talks to the real Bongo Cat Steam game (app 3419430). Rust owns Steam, input and windows; React draws the cats. **Read `README_DEV.md` before you make non-trivial changes.** It covers the architecture, the overlay and click-through design, the multiplayer protocol, and CI.

## Commands

```sh
pnpm install
pnpm tauri dev                 # run app (starts Steam if closed)
pnpm tauri build               # bundle (dmg / NSIS)
pnpm build                     # tsc typecheck + vite build (what CI runs for frontend)
cd src-tauri && cargo test     # Rust tests; art test skips if game not installed
cd src-tauri && cargo test lobby::tests::base59_roundtrip   # single test
```

There is no lint script and no frontend test suite. Version lives in `package.json` only, and `tauri.conf.json` reads it.

## Architecture in brief

- Two windows, one frontend bundle: `src/main.tsx` routes by window label (`menu` goes to `src/menu/Menu.tsx`, anything else to `src/overlay/Overlay.tsx`).
- `src-tauri/src/lib.rs` holds the Tauri commands, tray, global input (rdev), click-through hit testing, and the main loop (Steam callbacks, taps to stats, lobby tick). The other modules are `lobby.rs` (Steam lobbies), `inventory.rs` (blocking ISteamInventory wrapper, since the steamworks crate lacks it), `art.rs` (copies sprites from the local game install) and `devdriver.rs`.
- Prefs live in localStorage (`src/lib/prefs.ts`) and are broadcast to all windows through the `prefs` event.
- The multiplayer protocol (lobby keys, chat channels, base59 lobby codes) must stay wire-compatible with the real game. Keep `lobby.rs` and `src/lib/lobby.ts` in sync, and see the tables in README_DEV.md.
- `build.rs` copies the Steam runtime lib out of the `steamworks-sys` sources (version parsed from `Cargo.lock`) to sit next to the binary. Bumping steamworks touches this.

## Gotchas

- Tauri sync commands run on the main thread. Never hold a mutex across window getters or setters, because that deadlocks. `update_hit` copies state out of the lock first.
- The overlay window is click-through and only as big as the bounding box around the cats. Hit areas are `[data-hit]` rects reported through `set_hit_rects`. CSS `:hover` does not work, so use the `hover` event from Rust.
- Lobby members are polled every 500 ms on purpose, because the steamworks 0.13 `LobbyChatUpdate` callback panics.
- Debug builds expose a dev driver on `127.0.0.1:7311` that runs JS in a window, so you can inspect the running app:
  `printf 'main\treturn document.title' | nc 127.0.0.1 7311`

## Conventions

- `src/components/ui/` is shadcn-generated (`components.json`).
- One branch per milestone, with stacked PRs via `gh stack`.
- Commit messages are written in caveman voice (see `git log`).
