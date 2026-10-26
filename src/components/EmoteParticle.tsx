import { useState } from "react";
import { artUrl, iconUrl, type Item } from "@/lib/items";

/** An emote floating up and fading out (needs the `emote-float` keyframes in the page). Falls back to the icon. */
export function EmoteParticle({ item, left, top }: { item: Item; left: number; top: number }) {
  const [src, setSrc] = useState(artUrl(item));
  return (
    <img
      src={src}
      onError={() => setSrc(iconUrl(item))}
      draggable={false}
      className="emote-float pointer-events-none absolute z-30 size-16"
      style={{ left, top }}
    />
  );
}
