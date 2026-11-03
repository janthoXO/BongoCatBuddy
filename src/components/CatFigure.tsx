import { useEffect, useState, type HTMLAttributes } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { artUrl, type Item } from "@/lib/items";

const PARTS = ["Left", "LeftPunch", "Right", "RightPunch"] as const;
// Bongo parts aren't on the item CDN, only in the game: Rust extracts them (`item_art`).
const drums = new Map<string, Promise<Record<string, string>>>();
function loadDrums(item: Item) {
  const name = item.name.replace(/ /g, "");
  let p = drums.get(name);
  if (!p) {
    p = Promise.all(
      PARTS.map((part) =>
        invoke<string>("item_art", { name: name + part })
          .then((f) => [part, convertFileSrc(f)])
          .catch(() => [part, ""]),
      ),
    ).then(Object.fromEntries);
    drums.set(name, p);
  }
  return p;
}
import catLeft from "@/assets/placeholder/catLeft.svg";
import catLeftPunch from "@/assets/placeholder/catLeftPunch.svg";
import catRight from "@/assets/placeholder/catRight.svg";
import catRightPunch from "@/assets/placeholder/catRightPunch.svg";

const placeholders = { catLeft, catLeftPunch, catRight, catRightPunch };
type Part = keyof typeof placeholders;

/**
 * Layout in "units" (y up), taken from the game's scene: every layer is a 128-unit
 * square centered at (x, y) around an origin. The figure box spans x -70..74 and
 * y -46..109 (hat top), so the origin sits at (70, 109) from the box's top-left.
 * Bongos hang below the cat: with them the box reaches down `BONGOS_H` more (to y -82;
 * their art ends ~14 above that, like the cat's does above -46).
 */
export const FIGURE_W = 144;
export const FIGURE_H = 155;
export const BONGOS_H = 36;
/** Figure height in units, with or without bongos. */
export const figureH = (bongos: boolean) => FIGURE_H + (bongos ? BONGOS_H : 0);
const OX = 70;
const OY = 109;
const BODY = { x: -6, y: 10 };
const HAT = { x: 10, y: 45 };
const BONGOS = { x: -16, y: -31 };

// The base cat comes from the installed game (extracted by Rust) or the placeholder.
let baseArt: Promise<Record<Part, string>> | null = null;
function loadBaseArt() {
  baseArt ??= invoke<string | null>("get_art")
    .then((dir) =>
      dir
        ? (Object.fromEntries(
            Object.keys(placeholders).map((n) => [n, convertFileSrc(`${dir}/${n}.png`)]),
          ) as Record<Part, string>)
        : placeholders,
    )
    .catch(() => placeholders);
  return baseArt;
}

type Props = {
  /** px per unit */
  unit: number;
  skin?: Item;
  hat?: Item;
  bongos?: Item;
  /** paws currently hitting */
  left?: boolean;
  right?: boolean;
  flip?: boolean;
} & HTMLAttributes<HTMLDivElement>;

/** The cat with its equipped skin, hat and bongos, `FIGURE_W x figureH(!!bongos)` units big. Extra props go on the box. */
export function CatFigure({ unit, skin, hat, bongos, left = false, right = false, flip = false, style, ...rest }: Props) {
  const [base, setBase] = useState<Record<Part, string>>(placeholders);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  useEffect(() => void loadBaseArt().then(setBase), []);
  const [drumArt, setDrumArt] = useState<{ id: number; urls: Record<string, string> } | null>(null);
  useEffect(() => {
    if (bongos) void loadDrums(bongos).then((urls) => setDrumArt({ id: bongos.id, urls }));
  }, [bongos?.id]);

  const ok = (url?: string) => (url && !broken.has(url) ? url : undefined);
  // Skin and bongo parts use the same names as the base art: <Name>Left, <Name>LeftPunch, ...
  const body = (part: string) => ok(skin && artUrl(skin, part)) ?? base[`cat${part}` as Part];
  const drum = (part: string) => (bongos && drumArt?.id === bongos.id ? ok(drumArt.urls[part]) : undefined);

  // Draw order like the game's scene. All variants stay mounted so taps don't flicker.
  const layers = [
    { k: "bongosLeftPunch", url: drum("LeftPunch"), at: BONGOS, show: left },
    { k: "catLeft", url: body("Left"), at: BODY, show: !left },
    { k: "catLeftPunch", url: body("LeftPunch"), at: BODY, show: left },
    { k: "catRight", url: body("Right"), at: BODY, show: !right },
    { k: "bongosLeft", url: drum("Left"), at: BONGOS, show: !left },
    { k: "bongosRight", url: drum("Right"), at: BONGOS, show: !right },
    { k: "bongosRightPunch", url: drum("RightPunch"), at: BONGOS, show: right },
    { k: "catRightPunch", url: body("RightPunch"), at: BODY, show: right },
    { k: "hat", url: ok(hat && artUrl(hat)), at: HAT, show: true },
  ];

  return (
    <div
      {...rest}
      // the overlay reads these to make only the visible pixels clickable
      data-figure
      data-flip={flip || undefined}
      style={{
        position: "relative",
        width: FIGURE_W * unit,
        height: figureH(!!bongos) * unit,
        transform: flip ? "scaleX(-1)" : undefined,
        ...style,
      }}
    >
      {layers.map(({ k, url, at, show }) => {
        if (!url) return null;
        return (
          <img
            key={k}
            src={url}
            alt=""
            draggable={false}
            onError={() => setBroken((s) => new Set(s).add(url))}
            className={`pointer-events-none absolute ${show ? "" : "invisible"}`}
            style={{
              left: (OX + at.x - 64) * unit,
              top: (OY - at.y - 64) * unit,
              width: 128 * unit,
              height: 128 * unit,
            }}
          />
        );
      })}
    </div>
  );
}
