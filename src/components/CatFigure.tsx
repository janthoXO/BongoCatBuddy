import { useEffect, useState, type HTMLAttributes } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { artUrl, type Item } from "@/lib/items";
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
 */
export const FIGURE_W = 144;
export const FIGURE_H = 155;
const OX = 70;
const OY = 109;
const BODY = { x: -6, y: 10 };
const HAT = { x: 10, y: 45 };

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
  /** paws currently hitting */
  left?: boolean;
  right?: boolean;
  flip?: boolean;
} & HTMLAttributes<HTMLDivElement>;

/** The cat with its equipped skin and hat, `FIGURE_W x FIGURE_H` units big. Extra props go on the box. */
export function CatFigure({ unit, skin, hat, left = false, right = false, flip = false, style, ...rest }: Props) {
  const [base, setBase] = useState<Record<Part, string>>(placeholders);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  useEffect(() => void loadBaseArt().then(setBase), []);

  // Skin parts use the same names as the base art: <Name>Left, <Name>LeftPunch, ...
  const src = (p: Part) => {
    const url = skin && artUrl(skin, p.slice(3));
    return url && !broken.has(url) ? url : base[p];
  };
  const hatUrl = hat && artUrl(hat);
  const markBroken = (url?: string) => url && setBroken((s) => new Set(s).add(url));

  // Draw order like the game: body, hat, right paw. All variants stay mounted so taps don't flicker.
  const layers = [
    { p: "catLeft", at: BODY, show: !left },
    { p: "catLeftPunch", at: BODY, show: left },
    { p: "hat", at: HAT, show: true },
    { p: "catRight", at: BODY, show: !right },
    { p: "catRightPunch", at: BODY, show: right },
  ] as const;

  return (
    <div
      {...rest}
      style={{
        position: "relative",
        width: FIGURE_W * unit,
        height: FIGURE_H * unit,
        transform: flip ? "scaleX(-1)" : undefined,
        ...style,
      }}
    >
      {layers.map(({ p, at, show }) => {
        const url = p === "hat" ? hatUrl : src(p);
        if (!url || (p === "hat" && broken.has(url))) return null;
        return (
          <img
            key={p}
            src={url}
            alt=""
            draggable={false}
            onError={() => markBroken(p === "hat" ? hatUrl : skin && artUrl(skin, p.slice(3)))}
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
