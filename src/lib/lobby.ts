import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FIGURE_H, FIGURE_W } from "@/components/CatFigure";

/** Lobby member as Rust reports it (see `lobby::Member`). Steam ids are strings (u64). */
export type Member = {
  id: string;
  name: string;
  hat: number | null;
  skin: number | null;
  chest_ready: boolean;
  emote_chest_ready: boolean;
};

export type LobbyState = {
  /** raw lobby id */
  id: string;
  /** what players type to join */
  code: string;
  name: string;
  visibility: Visibility;
  /** we own the lobby */
  owner: boolean;
  /** our own steam id */
  me: string;
  members: Member[];
};

export type Visibility = 0 | 1 | 2; // private, friends only, public
export const VISIBILITY_NAMES = ["Private", "Friends", "Public"] as const;

export type ListedLobby = { id: string; name: string; members: number; max: number };
export type LobbyPage = { lobbies: ListedLobby[]; more: boolean };
/** `lobby`: raw id of the lobby they are in, when Steam knows it. */
export type Friend = { id: string; name: string; in_game: boolean; lobby: string | null };

/** Lobby chat channels, as the game numbers them. */
export const CH = {
  /** number of taps since the last message */
  taps: 2,
  /** speech bubble text */
  speech: 3,
  /** "<target steamid>:<0 cosmetic | 1 emote>": the sender paid to open the target's chest */
  openChest: 4,
  /** item def id the sender just got */
  item: 5,
  /** emote def id the sender used */
  emote: 6,
  resetLeaderboard: 7,
  /** "<target steamid>": the sender patted the target */
  pat: 8,
} as const;

/** A chat message from another player in our lobby (own messages are never delivered). */
export type LobbyMsg = { from: string; channel: number; message: string };

export const MAX_SPEECH = 100;

/** The lobby we are in, or null. */
export function useLobby() {
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  useEffect(() => {
    invoke<LobbyState | null>("get_lobby").then(setLobby).catch(() => {});
    const un = listen<LobbyState | null>("lobby", (e) => setLobby(e.payload));
    return () => void un.then((f) => f());
  }, []);
  return lobby;
}

/** Calls `cb` for every lobby chat message; returns the unlisten function promise. */
export const onLobbyMsg = (cb: (m: LobbyMsg) => void) => listen<LobbyMsg>("lobby-msg", (e) => cb(e.payload));

export const lobbySend = (channel: number, message: string) =>
  invoke<boolean>("lobby_send", { channel, message }).catch(() => false);

/** Size of a remote cat window: the cat figure plus room for a speech bubble on top and a name tag below. */
export const remoteLayout = (scale: number) => {
  const u = 1.25 * scale;
  const figW = FIGURE_W * u;
  const figH = FIGURE_H * u;
  const top = 44; // speech bubble / item popup
  // The sprites end ~14 units above the figure box, so the name tag + gift chests row tucks up into it.
  const bottom = 40 - 14 * u;
  return { u, figW, figH, top, w: Math.ceil(Math.max(figW + 24, 180)), h: Math.ceil(top + figH + bottom) };
};

/**
 * Members in the player's order: the tracked ones (`order`, set by dragging in the Lobby tab)
 * first, in that order, then everyone else in Steam's order.
 */
export function ordered<T extends { id: string }>(members: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const tracked = members.filter((m) => rank.has(m.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...tracked, ...members.filter((m) => !rank.has(m.id))];
}

/**
 * The new `order` after `id` is dragged to index `to` in `shown` (ids as `ordered` lists them).
 * The dragged player gets tracked, and so does every untracked one between the tracked ones and
 * its new spot (tracked stay on top); the ones it passed below that stay untracked. Tracked
 * players not here now keep their place after the one before them.
 */
export function moveCat(shown: string[], order: string[], id: string, to: number): string[] {
  const i = shown.indexOf(id);
  if (i < 0) return order;
  const count = shown.filter((m) => order.includes(m)).length + (order.includes(id) ? 0 : 1);
  const next = shown.filter((m) => m !== id);
  next.splice(to, 0, id);
  const out = next.slice(0, Math.max(to + 1, count));
  order.forEach((m, k) => {
    if (!out.includes(m)) out.splice(k ? out.indexOf(order[k - 1]) + 1 : 0, 0, m);
  });
  return out;
}
