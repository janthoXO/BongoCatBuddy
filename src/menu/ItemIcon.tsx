import { useState } from "react";
import { iconUrl, type Item } from "@/lib/items";
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
