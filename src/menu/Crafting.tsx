import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MinusIcon, PlusIcon, PartyPopperIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { CRAFT_INPUT, CRAFT_RECIPES, useItems, type Item, type Quality } from "@/lib/items";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { ItemIcon, QualityDot, qualityBadge, tint } from "./ItemIcon";

type Group = "cosmetics" | "emote";
const GROUPS: Record<Group, string> = { cosmetics: "Cosmetics", emote: "Emotes" };
const QUALITY_OPTIONS: Quality[] = ["common", "uncommon", "rare", "epic"];

export function Crafting() {
  const { catalog, owned } = useItems();
  const [prefs, update] = usePrefs();
  const [group, setGroup] = useState<Group>("cosmetics");
  const [quality, setQuality] = useState<Quality>("common");
  const [slotted, setSlotted] = useState<Record<number, number>>({});
  const [running, setRunning] = useState(false);
  const [won, setWon] = useState<Item[]>([]);

  const candidates = useMemo(
    () =>
      (owned ?? [])
        .filter(
          (i) =>
            i.craftGroup === group &&
            i.craftQuality === quality &&
            i.qty > 1 &&
            (prefs.craftAllowFavorites || !prefs.favorites.includes(i.id)) &&
            !(prefs.craftExcludeEvent && i.event),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [owned, group, quality, prefs.craftAllowFavorites, prefs.craftExcludeEvent, prefs.favorites],
  );

  if (!owned || !catalog) {
    return (
      <div className="flex flex-1 flex-col gap-3">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="flex-1 rounded-xl" />
      </div>
    );
  }

  // only count what is still a valid candidate (and still owned)
  const amount = (i: Item) => Math.min(slotted[i.id] ?? 0, i.qty - 1);
  const total = candidates.reduce((s, i) => s + amount(i), 0);
  const exchanges = Math.floor(total / CRAFT_INPUT);
  const set = (i: Item, n: number) => setSlotted((s) => ({ ...s, [i.id]: Math.max(0, Math.min(i.qty - 1, n)) }));
  const recipe = CRAFT_RECIPES[group][quality];

  async function exchange() {
    if (recipe === undefined) return;
    let left = exchanges * CRAFT_INPUT;
    const items: [number, number][] = [];
    for (const i of candidates) {
      const n = Math.min(amount(i), left);
      if (n > 0) items.push([i.id, n]);
      left -= n;
    }
    setRunning(true);
    try {
      const ids = await invoke<number[]>("craft", { recipe, items });
      setWon(ids.map((id) => catalog?.get(id)).filter((i): i is Item => !!i));
      setSlotted({});
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRunning(false);
    }
  }

  const dupes = (q: Quality) =>
    (owned ?? [])
      .filter(
        (i) =>
          i.craftGroup === group &&
          i.craftQuality === q &&
          (prefs.craftAllowFavorites || !prefs.favorites.includes(i.id)) &&
          !(prefs.craftExcludeEvent && i.event),
      )
      .reduce((s, i) => s + i.qty - 1, 0);
  // icons of the items in the current batch of 10
  const units = candidates.flatMap((i) => Array<Item>(amount(i)).fill(i));
  const filled = total === 0 ? 0 : total % CRAFT_INPUT || CRAFT_INPUT;
  const batch = units.slice(Math.max(0, total - filled), total);
  const tabCls =
    "h-7 flex-1 gap-1.5 rounded-md px-3 text-sm capitalize text-foreground/70 after:hidden data-active:bg-card data-active:text-foreground data-active:shadow-sm";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Trade 10 duplicates for a random item of the next quality. One copy of each item always stays with you.
      </p>
      <div className="flex flex-col gap-2">
        <Tabs
          value={group}
          onValueChange={(v) => (setGroup(v as Group), setSlotted({}))}
        >
          <TabsList className="group-data-horizontal/tabs:h-auto w-full gap-0.5 rounded-lg bg-muted p-0.5">
            {(Object.keys(GROUPS) as Group[]).map((g) => (
              <TabsTrigger key={g} value={g} className={tabCls}>
                {GROUPS[g]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Tabs value={quality} onValueChange={(v) => (setQuality(v as Quality), setSlotted({}))}>
          <TabsList className="group-data-horizontal/tabs:h-auto w-full gap-0.5 rounded-lg bg-muted p-0.5">
            {QUALITY_OPTIONS.map((q) => {
              const n = dupes(q);
              return (
                <TabsTrigger key={q} value={q} className={cn(tabCls, "gap-1 px-1 text-xs", n === 0 && "opacity-50")}>
                  <QualityDot quality={q} />
                  {q}
                  <span className="tabular-nums text-muted-foreground">{n}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="min-h-0 flex-1 rounded-xl bg-card">
        {candidates.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PartyPopperIcon />
              </EmptyMedia>
              <EmptyTitle>No duplicates here</EmptyTitle>
              <EmptyDescription>Duplicates of this quality will show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y">
            {candidates.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-3 py-1.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg" style={tint(i.quality)}>
                  <ItemIcon item={i} className="size-9" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{i.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">×{i.qty}</span>
                <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
                  <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label="Fewer" disabled={amount(i) === 0} onClick={() => set(i, amount(i) - 1)}>
                    <MinusIcon />
                  </Button>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">{amount(i)}</span>
                  <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label="More" disabled={amount(i) >= i.qty - 1} onClick={() => set(i, amount(i) + 1)}>
                    <PlusIcon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1" role="img" aria-label={`${filled} of ${CRAFT_INPUT} slots filled`}>
          {Array.from({ length: CRAFT_INPUT }, (_, n) => {
            const it = batch[n];
            return (
              <span
                key={n}
                className={cn(
                  "flex size-6 items-center justify-center overflow-hidden rounded-full border transition-colors",
                  it ? "bg-card" : "border-dashed border-border bg-muted/60",
                )}
              >
                {it && <ItemIcon item={it} className="size-5" />}
              </span>
            );
          })}
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {filled}/{CRAFT_INPUT}
        </span>
        {exchanges > 1 && <Badge className="tabular-nums">×{exchanges} exchanges</Badge>}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          className="h-9 rounded-lg px-4"
          onClick={() => setSlotted(Object.fromEntries(candidates.map((i) => [i.id, i.qty - 1])))}
        >
          Fill duplicates
        </Button>
        <Button variant="ghost" className="h-9 rounded-lg px-4" onClick={() => setSlotted({})}>
          Clear
        </Button>
        <Button
          className="ml-auto h-10 rounded-lg px-6 text-base"
          disabled={exchanges === 0 || running || recipe === undefined}
          onClick={exchange}
        >
          {running && <Spinner data-icon="inline-start" />}
          Exchange{exchanges > 0 ? ` ×${exchanges}` : ""}
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <Label className="gap-2 text-sm font-normal">
          <Switch checked={prefs.craftAllowFavorites} onCheckedChange={(v) => update({ craftAllowFavorites: v })} />
          Include favorites
        </Label>
        <Label className="gap-2 text-sm font-normal">
          <Switch checked={!prefs.craftExcludeEvent} onCheckedChange={(v) => update({ craftExcludeEvent: !v })} />
          Include event items
        </Label>
      </div>

      <Dialog open={won.length > 0} onOpenChange={(o) => !o && setWon([])}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>You got!</DialogTitle>
            <DialogDescription>New items were added to your inventory.</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-72 flex-wrap justify-center gap-3 overflow-y-auto p-1">
            {won.map((i, n) => (
              <div
                key={n}
                className="flex w-32 flex-col items-center gap-1.5 rounded-xl p-3 text-center"
                style={tint(i.quality)}
              >
                <ItemIcon item={i} className="size-20" />
                <span className="text-sm leading-tight font-semibold">{i.name}</span>
                {i.quality && (
                  <Badge variant="outline" className="capitalize" style={qualityBadge(i.quality)}>
                    {i.quality}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
