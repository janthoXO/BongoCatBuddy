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
export type Friend = { id: string; name: string; in_game: boolean };

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
