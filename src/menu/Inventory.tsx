import { useMemo, useState } from "react";
import { CheckIcon, EyeIcon, EyeOffIcon, PackageOpenIcon, SearchIcon, StarIcon } from "lucide-react";
import { CatFigure } from "@/components/CatFigure";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QUALITIES, QUALITY_COLORS, artUrl, useItems, type Item, type Quality } from "@/lib/items";
import { MAX_WHEEL_EMOTES, usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { ItemIcon, qualityBadge, tint } from "./ItemIcon";

const CATEGORIES = {
  hat: "Hats",
  skin: "Skins",
  emote: "Emotes",
  other: "Other",
} as const;
type Category = keyof typeof CATEGORIES;

function categoryOf(i: Item): Category {
  if (i.slot === "hat") return "hat";
  if (i.slot === "skin") return "skin";
  if (i.slot === "emote" || i.slot === "consumable") return "emote";
  return "other";
}

const toggle = (list: number[], id: number) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

const segment =
  "h-7 rounded-md px-3 text-sm aria-pressed:bg-card dark:aria-pressed:bg-white/15 aria-pressed:text-foreground aria-pressed:shadow-sm aria-pressed:hover:bg-card";

export function Inventory() {
  const { owned } = useItems();
  const [prefs, update] = usePrefs();
  const [category, setCategory] = useState<Category>("hat");
  const [showHidden, setShowHidden] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [qualities, setQualities] = useState<Quality[]>([]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (owned ?? []).filter(
      (i) =>
        (showHidden || !prefs.hidden.includes(i.id)) &&
        (!q || i.name.toLowerCase().includes(q)) &&
        (qualities.length === 0 || (i.quality !== null && qualities.includes(i.quality))),
    );
  }, [owned, showHidden, prefs.hidden, query, qualities]);
  const counts = useMemo(() => {
    const c: Record<Category, number> = { hat: 0, skin: 0, emote: 0, other: 0 };
    for (const i of visible) c[categoryOf(i)]++;
    return c;
  }, [visible]);
  const items = useMemo(() => {
    const rank = (i: Item) => (i.quality ? QUALITIES.indexOf(i.quality) : -1);
    return visible
      .filter((i) => categoryOf(i) === category)
      .sort(
        (a, b) =>
          Number(prefs.favorites.includes(b.id)) - Number(prefs.favorites.includes(a.id)) ||
          rank(b) - rank(a) ||
          a.name.localeCompare(b.name),
      );
  }, [visible, category, prefs.favorites]);

  const selected = owned?.find((i) => i.id === selectedId) ?? null;
  const isEquipped = (i: Item) =>
    i.slot === "hat" || i.slot === "skin"
      ? prefs.equipped[i.slot] === i.id
      : prefs.emotes.includes(i.id);
  const wheelFull = prefs.emotes.length >= MAX_WHEEL_EMOTES;

  const worn = (s: "hat" | "skin") => owned?.find((o) => o.id === prefs.equipped[s]);

  /** Equip/unequip or add/remove from the wheel. */
  function primary(item: Item) {
    if (item.slot === "hat" || item.slot === "skin") {
      const { [item.slot]: _, ...rest } = prefs.equipped;
      update({ equipped: isEquipped(item) ? rest : { ...prefs.equipped, [item.slot]: item.id } });
    } else if (item.slot === "emote" || item.slot === "consumable") {
      if (!isEquipped(item) && wheelFull) return;
      update({ emotes: toggle(prefs.emotes, item.id) });
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center gap-3 rounded-xl bg-card p-3">
        {selected ? (
          details(selected)
        ) : (
          <>
            <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary">
              <CatFigure unit={0.65} hat={worn("hat")} skin={worn("skin")} />
            </div>
            <p className="text-sm text-muted-foreground">Tap an item to preview it</p>
          </>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          <InputGroup className="h-9 flex-1 rounded-lg border-0 bg-card">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search items"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search items"
            />
          </InputGroup>
          <ToggleGroup
            multiple
            spacing={1}
            value={qualities}
            onValueChange={(v) => setQualities(v as Quality[])}
            aria-label="Filter by quality"
            className="rounded-lg bg-card p-1.5"
          >
            {QUALITIES.map((q) => (
              <Tooltip key={q}>
                <TooltipTrigger
                  render={
                    <ToggleGroupItem
                      value={q}
                      aria-label={q}
                      className="size-5 min-w-5 rounded-full p-0 ring-offset-1 ring-offset-card hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-primary"
                      style={{ background: QUALITY_COLORS[q] }}
                    />
                  }
                />
                <TooltipContent className="capitalize">{q}</TooltipContent>
              </Tooltip>
            ))}
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  pressed={showHidden}
                  onPressedChange={setShowHidden}
                  aria-label="Show hidden items"
                  className="size-9 rounded-lg bg-card aria-pressed:bg-accent aria-pressed:text-primary"
                />
              }
            >
              {showHidden ? <EyeIcon /> : <EyeOffIcon />}
            </TooltipTrigger>
            <TooltipContent>{showHidden ? "Hiding nothing" : "Show hidden items"}</TooltipContent>
          </Tooltip>
        </div>
        <ToggleGroup
          value={[category]}
          onValueChange={(v) => v[0] && setCategory(v[0] as Category)}
          className="w-full rounded-lg bg-muted p-0.5"
        >
          {(Object.keys(CATEGORIES) as Category[]).map((c) => (
            <ToggleGroupItem key={c} value={c} className={cn(segment, "flex-1")}>
              {CATEGORIES[c]}
              <span className="tabular-nums opacity-70">{counts[c]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {!owned ? (
          <div className="grid grid-cols-[repeat(auto-fill,64px)] gap-2.5 p-1.5">
            {Array.from({ length: 24 }, (_, n) => (
              <Skeleton key={n} className="size-16 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PackageOpenIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing here</EmptyTitle>
              <EmptyDescription>
                {query || qualities.length
                  ? "No items match your filters."
                  : `You don't own any ${CATEGORIES[category].toLowerCase()} yet.`}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,64px)] justify-between gap-2.5 p-1.5 pr-3">
            {items.map((i) => (
              <Tooltip key={i.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => setSelectedId(i.id)}
                      onDoubleClick={() => primary(i)}
                      style={tint(i.quality)}
                      className={cn(
                        "relative flex size-16 items-center justify-center rounded-xl bg-card outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/60",
                        i.id === selectedId && "ring-2 ring-primary",
                        prefs.hidden.includes(i.id) && "opacity-50",
                      )}
                    />
                  }
                >
                  <ItemIcon item={i} className="size-12" />
                  {i.qty > 1 && (
                    <Badge variant="secondary" className="absolute -right-1 -bottom-1 h-4 px-1 text-[10px] tabular-nums">
                      {i.qty}
                    </Badge>
                  )}
                  {prefs.favorites.includes(i.id) && (
                    <StarIcon className="absolute top-1 left-1 size-3.5 fill-primary text-primary" />
                  )}
                  {isEquipped(i) && (
                    <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card">
                      <CheckIcon className="size-3" strokeWidth={3} />
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent>{i.name}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );

  // Called as a function, not rendered as <Details/>: a component defined in here would be a
  // new type on every render (each tap re-renders via the score), remounting the buttons
  // between mousedown and mouseup and swallowing clicks.
  function details(item: Item) {
    const fav = prefs.favorites.includes(item.id);
    const hid = prefs.hidden.includes(item.id);
    const equipSlot = item.slot === "hat" || item.slot === "skin" ? item.slot : null;
    const wheelSlot = item.slot === "emote" || item.slot === "consumable";
    const inWheel = prefs.emotes.includes(item.id);
    const blocked = wheelSlot && !inWheel && wheelFull;
    return (
      <>
        <div
          className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary"
          style={tint(item.quality, 22)}
        >
          {equipSlot ? (
            <CatFigure
              key={item.id}
              unit={0.65}
              hat={equipSlot === "hat" ? item : worn("hat")}
              skin={equipSlot === "skin" ? item : worn("skin")}
            />
          ) : (
            <BigArt key={item.id} item={item} />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h3 className="truncate text-base leading-tight font-semibold">{item.name}</h3>
          <div className="flex flex-wrap items-center gap-1">
            {item.quality && (
              <Badge variant="outline" className="capitalize" style={qualityBadge(item.quality)}>
                {item.quality}
              </Badge>
            )}
            {item.slot && <Badge variant="secondary">{item.slot}</Badge>}
            {item.event && <Badge variant="secondary">{item.event}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">Owned ×{item.qty}</p>
          <div className="flex items-center gap-1.5">
            {(equipSlot || wheelSlot) && (
              <Button size="sm" disabled={blocked} onClick={() => primary(item)} className="flex-1 rounded-lg">
                {equipSlot
                  ? prefs.equipped[equipSlot] === item.id ? "Unequip" : "Equip"
                  : inWheel ? "Remove from wheel" : "Add to wheel"}
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={fav ? "Unfavorite" : "Favorite"}
                    onClick={() => update({ favorites: toggle(prefs.favorites, item.id) })}
                  />
                }
              >
                <StarIcon className={cn(fav && "fill-primary text-primary")} />
              </TooltipTrigger>
              <TooltipContent>{fav ? "Unfavorite" : "Favorite"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={hid ? "Unhide" : "Hide"}
                    onClick={() => update({ hidden: toggle(prefs.hidden, item.id) })}
                  />
                }
              >
                {hid ? <EyeIcon /> : <EyeOffIcon />}
              </TooltipTrigger>
              <TooltipContent>{hid ? "Unhide" : "Hide"}</TooltipContent>
            </Tooltip>
          </div>
          {blocked && <p className="text-xs text-muted-foreground">Wheel is full ({MAX_WHEEL_EMOTES}).</p>}
        </div>
      </>
    );
  }
}

/** Full art with the inventory icon as fallback. */
function BigArt({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <ItemIcon item={item} className="size-20" />
  ) : (
    <img src={artUrl(item)} alt="" onError={() => setFailed(true)} className="size-24 object-contain" />
  );
}
