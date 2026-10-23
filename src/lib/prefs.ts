import { useCallback, useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";

/** Player settings and local item state, shared by all windows. Defaults follow the game. */
export type Prefs = {
  /** cat size multiplier, one of CAT_SCALES */
  catScale: number;
  alwaysOnTop: boolean;
  lockPosition: boolean;
  flip: boolean;
  /** mouse clicks don't count as taps */
  ignoreMouse: boolean;
  /** only show the score while hovering the cat */
  hideCounter: boolean;
  catBobbing: boolean;
  /** pop the chest up when it's ready */
  showChestPopup: boolean;
  /** keep the chests (with their timers) visible all the time */
  alwaysShowChest: boolean;
  showEmoteChest: boolean;
  animateChestPurchase: boolean;
  autoEquipDrops: boolean;
  showEmoteWheel: boolean;
  /** crafting may auto-slot favorite items */
  craftAllowFavorites: boolean;
  /** crafting never auto-slots event items */
  craftExcludeEvent: boolean;
  /** rejoin the last lobby on start */
  joinLastLobby: boolean;
  /** raw id of the lobby we were in when the app closed */
  lastLobby?: string;
  /** "row": other players' cats line up beside ours and follow it; "free": each is dragged on its own */
  catLayout: "row" | "free";
  /** at most this many other cats get a window (each one is a webview, ~100 MB) */
  maxCats: number;
  /** size of other players' cats, one of CAT_SCALES */
  remoteCatScale: number;
  showPlayerNames: boolean;
  /** show what other players get from chests */
  multiplayerPopups: boolean;
  /** react to pats from others */
  receivePats: boolean;
  muteChats: boolean;
  /** steam ids whose cat is not shown */
  hiddenPlayers: string[];
  equipped: Partial<Record<"hat" | "skin", number>>;
  /** emote/consumable ids shown in the emote wheel */
  emotes: number[];
  favorites: number[];
  hidden: number[];
};

export const CAT_SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];
export const MAX_WHEEL_EMOTES = 8;
export const MAX_CATS_CHOICES = [4, 8, 12, 20];

const DEFAULTS: Prefs = {
  catScale: 1,
  alwaysOnTop: true,
  lockPosition: false,
  flip: false,
  ignoreMouse: false,
  hideCounter: false,
  catBobbing: false,
  showChestPopup: true,
  alwaysShowChest: false,
  showEmoteChest: true,
  animateChestPurchase: true,
  autoEquipDrops: false,
  showEmoteWheel: true,
  craftAllowFavorites: false,
  craftExcludeEvent: true,
  joinLastLobby: true,
  catLayout: "row",
  maxCats: 4,
  remoteCatScale: 0.75,
  showPlayerNames: true,
  multiplayerPopups: true,
  receivePats: true,
  muteChats: false,
  hiddenPlayers: [],
  equipped: {},
  emotes: [],
  favorites: [],
  hidden: [],
};

const KEY = "prefs";

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

/** Current prefs and an updater; updates are saved and broadcast to every window. */
export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState(load);
  useEffect(() => {
    const un = listen<Prefs>("prefs", (e) => setPrefs(e.payload));
    return () => void un.then((f) => f());
  }, []);
  const update = useCallback((patch: Partial<Prefs>) => {
    const next = { ...load(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // storage unavailable: still apply for this session
    }
    setPrefs(next);
    void emit("prefs", next);
  }, []);
  return [prefs, update];
}
