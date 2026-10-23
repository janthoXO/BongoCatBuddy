import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MinusIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CRAFT_INPUT, CRAFT_RECIPES, QUALITY_COLORS, useItems, type Item, type Quality } from "@/lib/items";
import { usePrefs } from "@/lib/prefs";
import { ItemIcon } from "./ItemIcon";

type Group = "cosmetics" | "emote";
const GROUPS: Record<Group, string> = { cosmetics: "Cosmetics", emote: "Emotes" };
const QUALITY_OPTIONS: Quality[] = ["common", "uncommon", "rare", "epic"];

export function Crafting() {
  const { catalog, owned } = useItems();
  const [prefs] = usePrefs();
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
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-6" />
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Trade 10 duplicates of one quality for a random item of the next quality. One copy of each item is always kept.
      </p>
      <div className="flex flex-wrap gap-3">
        <ToggleGroup
          variant="outline"
          value={[group]}
          onValueChange={(v) => v[0] && (setGroup(v[0] as Group), setSlotted({}))}
        >
          {(Object.keys(GROUPS) as Group[]).map((g) => (
            <ToggleGroupItem key={g} value={g}>
              {GROUPS[g]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          variant="outline"
          value={[quality]}
          onValueChange={(v) => v[0] && (setQuality(v[0] as Quality), setSlotted({}))}
        >
          {QUALITY_OPTIONS.map((q) => (
            <ToggleGroupItem key={q} value={q} style={{ color: QUALITY_COLORS[q] }} className="capitalize">
              {q}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <ScrollArea className="min-h-0 flex-1 rounded-lg border">
        {candidates.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No duplicates in this category.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {candidates.map((i) => (
              <li key={i.id} className="flex items-center gap-3 p-2">
                <ItemIcon item={i} className="size-10" />
                <span className="min-w-0 flex-1 truncate text-sm" style={{ color: i.color }}>
                  {i.name}
                </span>
                <span className="text-xs text-muted-foreground">owned {i.qty}</span>
                <div className="flex items-center gap-1">
                  <Button size="icon-sm" variant="outline" aria-label="Fewer" disabled={amount(i) === 0} onClick={() => set(i, amount(i) - 1)}>
                    <MinusIcon />
                  </Button>
                  <span className="w-6 text-center text-sm tabular-nums">{amount(i)}</span>
                  <Button size="icon-sm" variant="outline" aria-label="More" disabled={amount(i) >= i.qty - 1} onClick={() => set(i, amount(i) + 1)}>
                    <PlusIcon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-sm">
          <span>
            slotted: {total} · exchanges possible: {exchanges}
          </span>
          <span className="text-muted-foreground">
            {total % CRAFT_INPUT}/{CRAFT_INPUT} to next
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${((total % CRAFT_INPUT) / CRAFT_INPUT) * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setSlotted(Object.fromEntries(candidates.map((i) => [i.id, i.qty - 1])))}
          >
            Fill duplicates
          </Button>
          <Button variant="outline" onClick={() => setSlotted({})}>
            Clear
          </Button>
          <Button className="ml-auto" disabled={exchanges === 0 || running || recipe === undefined} onClick={exchange}>
            {running && <Spinner data-icon="inline-start" />}
            Exchange{exchanges > 0 ? ` (${exchanges})` : ""}
          </Button>
        </div>
        {won.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-2">
            <span className="text-sm text-muted-foreground">You got</span>
            {won.map((i, n) => (
              <span key={n} className="flex items-center gap-1.5 text-sm" style={{ color: i.color }}>
                <ItemIcon item={i} className="size-8" />
                {i.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
