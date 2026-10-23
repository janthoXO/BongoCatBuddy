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
  equipped: Partial<Record<"hat" | "skin" | "bongos", number>>;
  /** emote/consumable ids shown in the emote wheel */
  emotes: number[];
  favorites: number[];
  hidden: number[];
};

export const CAT_SCALES = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];
export const MAX_WHEEL_EMOTES = 8;

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
