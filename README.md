# BongoCatBuddy

**Cat tap. You tap. Cat happy.** A clean, minimal client for the Bongo Cat Steam game.

[![Release](https://img.shields.io/github/v/release/janthoXO/BongoCatBuddy)](https://github.com/janthoXO/BongoCatBuddy/releases)
[![Build](https://github.com/janthoXO/BongoCatBuddy/actions/workflows/build.yml/badge.svg)](https://github.com/janthoXO/BongoCatBuddy/actions/workflows/build.yml)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows-blue)

BongoCatBuddy is an unofficial, minimal alternative client for the [Bongo Cat game on Steam](https://store.steampowered.com/app/3419430/). It runs instead of the game: a transparent, always-on-top cat taps along with your keyboard and mouse, and your taps, items and stats count on your real Steam account. You can also play in the game's multiplayer lobbies, together with people using the game.

It keeps the game's main features but leaves out the busy, gamified UI:

- a clean system look that follows light and dark mode
- a small menu that lives in the tray
- only the settings that matter

It is a lightweight Tauri app (Rust and the system web view), not a game engine.

## Features

- **Desktop pet overlay.** A transparent, always-on-top cat that taps with every global key press and mouse click, in any app. Click the cat to always show your score or only on hover, right-click it for the menu. Cat size, flip, screen choice and whether mouse clicks count are configurable.
- **Tray menu.** Click the tray (menu bar) icon for a small panel with your items, crafting, lobbies and settings. It closes when you click elsewhere.
- **Real Steam progress.** The app talks to Steam directly through the Steamworks API, so taps, score and stats count for your Steam account in the real game.
- **Inventory, chests and crafting.** Browse your hats, skins and emotes with a live preview on your cat. When a cosmetic or emote chest is ready, it appears next to your score (1000 taps each). Craft new items from duplicates.
- **Cosmetics and emotes.** Equip hats and skins, or let a random outfit change every 15, 30 or 60 minutes. Pick favorite emotes; they pop up in a small bar above your cat when you hover it.
- **Multiplayer lobbies.** Join the game's Steam lobbies by code, join a random lobby, pick from the public list, or invite online Steam friends. A lobby holds up to 250 members. Other players' cats appear on your screen and yours on theirs.
- **Social extras.** Pat other cats, send chat bubbles, see what others get from chests, and gift a chest to another player for 1000 taps.
- **Light on memory.** The overlay window is only as big as the box around the cats, not the whole screen. In a dev build that is about 118 MB in total, against about 330 MB for a full-screen overlay. A side-by-side comparison with the game is planned in [#14](https://github.com/janthoXO/BongoCatBuddy/issues/14).

## Install

Releases: <https://github.com/janthoXO/BongoCatBuddy/releases>

### macOS (Apple Silicon), Homebrew

```sh
brew tap janthoXO/bongocatbuddy https://github.com/janthoXO/BongoCatBuddy
brew install --cask bongocatbuddy
```

The app is self-signed, not notarized. The cask removes the quarantine flag for you. On first start, allow it in System Settings, Privacy & Security, Input Monitoring (add it with + if it's not listed), then restart it.

Manual install: download `BongoCatBuddy_<version>_aarch64.dmg` from Releases and drag the app to Applications. If macOS blocks it, open System Settings, Privacy & Security, and click **Open Anyway**.

### Windows

Download `BongoCatBuddy_<version>_x64-setup.exe` from Releases and run it. The installer is unsigned, so SmartScreen may warn: click **More info**, then **Run anyway**.

### Requirements

- Steam installed and logged in. If Steam is closed, the app starts it.
- You own the Bongo Cat game. Install it too, so the app can read the cat art from it (see the FAQ).
- macOS only: allow Input Monitoring / Accessibility for BongoCatBuddy so it can count keys system-wide.

## Quick start

1. Start Steam.
2. Launch BongoCatBuddy. The cat appears on your screen.
3. Click the tray (menu bar) icon to open the menu. Right-clicking your cat opens it too.
4. The menu has Items, Craft, Lobby and Settings tabs.
5. To play with others, open the **Lobby** tab and join by code, join random, or pick a public lobby.

## FAQ

### Is BongoCatBuddy official?

No. It is an unofficial community project, not affiliated with or endorsed by the developers of the Bongo Cat game or by Valve.

### Do my taps count in the real game?

Yes. The app uses the Steamworks API with the game's app id (3419430), so taps, stats and items go to your own Steam account, as if you were running the game. You must be logged in to Steam and own the game.

### Does it ship the game's art?

No. The cat sprites are not included. On first start the app extracts them from your own installed copy of the game into its app data folder. If the game is not installed, a placeholder cat is shown.

### Can I play in the same lobbies as other Bongo Cat players?

Yes. The app speaks the same lobby protocol as the game, so players using the game and players using BongoCatBuddy see each other.

### Which platforms are supported?

Release builds exist for macOS on Apple Silicon and Windows x64. Intel Macs and Linux have no release build yet, but you can build from source.

### What happens on macOS without Input Monitoring permission?

The app shows a notice that it cannot read keys. Key presses are not counted, but the cats stay clickable, because the app falls back to polling the cursor position. Allow the permission and restart the app to fix it.

### How much memory does it use?

About 118 MB in total in a dev build (app 40 MB, web content 62 MB, GPU 16 MB), because the transparent overlay window only covers the cats. A full-screen overlay measured about 330 MB.

## Development

See [README_DEV.md](README_DEV.md) for setup, architecture and the multiplayer protocol. Built with Tauri 2 (Rust), React and shadcn/ui.

## Disclaimer

BongoCatBuddy is an unofficial fan project. It is not affiliated with, endorsed by, or connected to the developers or publishers of the Bongo Cat game, or to Valve. Bongo Cat and Steam are trademarks of their respective owners. You need your own copy of the game.
