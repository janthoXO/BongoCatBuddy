import { useState, type CSSProperties } from "react";
import { QUALITY_COLORS, iconUrl, type Item, type Quality } from "@/lib/items";
import { cn } from "@/lib/utils";

/** Item icon; falls back to the first letters of the name when the image is missing. */
export function ItemIcon({ item, className }: { item: Item; className?: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className={cn("flex items-center justify-center text-xs font-medium text-muted-foreground", className)}>
      {item.name.slice(0, 2)}
    </span>
  ) : (
    <img
      src={iconUrl(item)}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("object-contain", className)}
    />
  );
}

/** Soft background tint in the quality color. */
export const tint = (q: Quality | null, pct = 14): CSSProperties | undefined =>
  q ? { background: `color-mix(in oklab, ${QUALITY_COLORS[q]} ${pct}%, transparent)` } : undefined;

export function QualityDot({ quality, className }: { quality: Quality | null; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15", className)}
      style={{ background: quality ? QUALITY_COLORS[quality] : "transparent" }}
    />
  );
}

/** Badge style tinted with the quality color (text stays foreground). */
export const qualityBadge = (q: Quality): CSSProperties => ({
  background: `color-mix(in oklab, ${QUALITY_COLORS[q]} 28%, transparent)`,
  borderColor: QUALITY_COLORS[q],
});
