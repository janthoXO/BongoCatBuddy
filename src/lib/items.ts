import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Raw item definition as Steam publishes it (see Rust `ItemDef`). */
type RawDef = { id: number; name: string; kind: string; tags: string; name_color: string };
type Owned = { def: number; qty: number };

export type Slot = "hat" | "skin" | "bongos" | "emote" | "consumable" | "uitheme";
export const QUALITIES = ["common", "uncommon", "rare", "epic", "legendary", "unique"] as const;
export type Quality = (typeof QUALITIES)[number];

export type Item = {
  id: number;
  name: string;
  slot: Slot | null;
  quality: Quality | null;
  /** quality used by duplicate exchanges (cosmetics_quality / emote_quality) */
  craftQuality: Quality | null;
  craftGroup: "cosmetics" | "emote" | null;
  event: string | null;
  color: string;
  qty: number;
};

export const QUALITY_COLORS: Record<Quality, string> = {
  common: "#B0B0B0",
  uncommon: "#5ACC3D",
  rare: "#258ED4",
  epic: "#B939DB",
  legendary: "#FFB000",
  unique: "#FF3D87",
};

/** Duplicate exchange recipes: 10 items of a quality -> 1 of the next one. */
export const CRAFT_RECIPES: Record<"cosmetics" | "emote", Partial<Record<Quality, number>>> = {
  cosmetics: { common: 16, uncommon: 17, rare: 18, epic: 19 },
  emote: { common: 30, uncommon: 31, rare: 32, epic: 33 },
};
export const CRAFT_INPUT = 10;

export const CHEST_PRICE = 1000;
export const CHEST_TOKEN = 98;
export const EMOTE_CHEST_TOKEN = 90;

const CDN = "https://pub-d6170922fa31462fa15463d240b18424.r2.dev/";
const file = (name: string) => name.replace(/ /g, "");
/** Inventory icon. */
export const iconUrl = (item: Pick<Item, "name">) => `${CDN}${file(item.name)}Icon.png`;
/** Full 256x256 art; `part` is "" for hats/emotes, or Left/LeftPunch/Right/RightPunch for skins and bongos. */
export const artUrl = (item: Pick<Item, "name">, part = "") => `${CDN}${file(item.name)}${part}.png`;

function toItem(d: RawDef, qty: number): Item {
  const tags = Object.fromEntries(
    d.tags.split(";").filter(Boolean).map((t) => t.split(":") as [string, string]),
  );
  const cq = (tags.cosmetics_quality ?? tags.emote_quality ?? null) as Quality | null;
  return {
    id: d.id,
    name: d.name,
    slot: (tags.itemslot ?? null) as Slot | null,
    quality: (tags.quality ?? null) as Quality | null,
    craftQuality: cq,
    craftGroup: tags.cosmetics_quality ? "cosmetics" : tags.emote_quality ? "emote" : null,
    event: tags.event ?? null,
    color: d.name_color ? `#${d.name_color}` : "#FFFFFF",
    qty,
  };
}

/** Live value of a Rust getter command, kept up to date by an event of the same data. */
function useLive<T>(command: string, event: string): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    invoke<T | null>(command).then((v) => v && setValue(v)).catch(() => {});
    const un = listen<T>(event, (e) => setValue(e.payload));
    return () => void un.then((f) => f());
  }, [command, event]);
  return value;
}

/**
 * All item definitions plus the owned items (qty > 0) with their counts.
 * `catalog` maps every definition id to an Item (qty 0 if not owned).
 * Both are null until Steam has delivered them.
 */
export function useItems() {
  const defs = useLive<RawDef[]>("get_catalog", "catalog");
  const owned = useLive<Owned[]>("get_inventory", "inventory");
  return useMemo(() => {
    if (!defs) return { catalog: null, owned: null };
    const qty = new Map(owned?.map((o) => [o.def, o.qty]));
    const catalog = new Map(defs.map((d) => [d.id, toItem(d, qty.get(d.id) ?? 0)]));
    return {
      catalog,
      owned: owned ? [...catalog.values()].filter((i) => i.qty > 0) : null,
    };
  }, [defs, owned]);
}
