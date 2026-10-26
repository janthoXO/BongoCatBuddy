import { useCallback, useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";

/** Player settings and local item state, shared by all windows. Defaults follow the game. */
export type Prefs = {
  /** size multiplier for every cat (ours and other players'), within CAT_SCALE */
  catScale: number;
  lockPosition: boolean;
  flip: boolean;
  /** mouse clicks don't count as taps */
  ignoreMouse: boolean;
  /** score bar hidden; clicking our cat toggles it */
  hideCounter: boolean;
  autoEquipDrops: boolean;
  /** minutes between random outfits (hat + skin), 0 = off; like the game's hat randomizer */
  randomOutfit: number;
  /** random outfits only use favorites */
  randomFavorites: boolean;
  /** crafting may auto-slot favorite items */
  craftAllowFavorites: boolean;
  /** crafting never auto-slots event items */
  craftExcludeEvent: boolean;
  /** rejoin the last lobby on start */
  joinLastLobby: boolean;
  /** raw id of the lobby we were in when the app closed */
  lastLobby?: string;
  /** "row"/"column": other players' cats line up beside / above-below ours and follow it; "free": each is dragged on its own */
  catLayout: "row" | "column" | "free";
  /** at most this many other cats are shown, within MAX_CATS */
  maxCats: number;
  /** show what other players get from chests */
  multiplayerPopups: boolean;
  /** react to pats from others */
  receivePats: boolean;
  muteChats: boolean;
  /** steam ids whose cat is not shown */
  hiddenPlayers: string[];
  /** screen (monitor name) the overlay covers; the primary one when unset or gone */
  monitor?: string;
  /** our cat's box, px inside the overlay */
  myPos?: [number, number];
  /** free layout: other cats' boxes by steam id */
  catPos: Record<string, [number, number]>;
  equipped: Partial<Record<"hat" | "skin", number>>;
  /** emote/consumable ids shown in the emote wheel */
  emotes: number[];
  favorites: number[];
  hidden: number[];
};

export const CAT_SCALE = { min: 0.5, max: 4, step: 0.05 };
export const MAX_WHEEL_EMOTES = 8;
export const MAX_CATS = { min: 1, max: 50, step: 1 };

const DEFAULTS: Prefs = {
  catScale: 1,
  lockPosition: false,
  flip: false,
  ignoreMouse: false,
  hideCounter: false,
  autoEquipDrops: false,
  randomOutfit: 0,
  randomFavorites: false,
  craftAllowFavorites: false,
  craftExcludeEvent: true,
  joinLastLobby: true,
  catLayout: "row",
  maxCats: 8,
  multiplayerPopups: true,
  receivePats: true,
  muteChats: false,
  hiddenPlayers: [],
  catPos: {},
  equipped: {},
  emotes: [],
  favorites: [],
  hidden: [],
};

const KEY = "prefs";

/** v inside the range; not a number: the default */
function clamp(v: unknown, r: { min: number; max: number }, def: number) {
  return typeof v === "number" && !Number.isNaN(v) ? Math.min(r.max, Math.max(r.min, v)) : def;
}

function load(): Prefs {
  try {
    const p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    p.catScale = clamp(p.catScale, CAT_SCALE, DEFAULTS.catScale);
    p.maxCats = clamp(p.maxCats, MAX_CATS, DEFAULTS.maxCats);
    return p;
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
