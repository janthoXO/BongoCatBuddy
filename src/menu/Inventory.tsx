import { useMemo, useState } from "react";
import { CheckIcon, EyeOffIcon, PackageOpenIcon, StarIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { QUALITIES, QUALITY_COLORS, useItems, type Item } from "@/lib/items";
import { MAX_WHEEL_EMOTES, usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { ItemIcon } from "./ItemIcon";

const CATEGORIES = {
  hat: "Hats",
  skin: "Skins",
  emote: "Emotes",
  other: "Other",
} as const;
type Category = keyof typeof CATEGORIES;

function categoryOf(i: Item): Category {
  if (i.slot === "hat") return "hat";
  if (i.slot === "skin" || i.slot === "bongos") return "skin";
  if (i.slot === "emote" || i.slot === "consumable") return "emote";
  return "other";
}

const toggle = (list: number[], id: number) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

export function Inventory() {
  const { owned } = useItems();
  const [prefs, update] = usePrefs();
  const [category, setCategory] = useState<Category>("hat");
  const [showHidden, setShowHidden] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const visible = useMemo(
    () => (owned ?? []).filter((i) => showHidden || !prefs.hidden.includes(i.id)),
    [owned, showHidden, prefs.hidden],
  );
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

  if (!owned) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  const selected = owned.find((i) => i.id === selectedId) ?? null;
  const isEquipped = (i: Item) =>
    i.slot === "hat" || i.slot === "skin" || i.slot === "bongos"
      ? prefs.equipped[i.slot] === i.id
      : prefs.emotes.includes(i.id);

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            variant="outline"
            value={[category]}
            onValueChange={(v) => v[0] && setCategory(v[0] as Category)}
          >
            {(Object.keys(CATEGORIES) as Category[]).map((c) => (
              <ToggleGroupItem key={c} value={c}>
                {CATEGORIES[c]}
                <span className="text-muted-foreground">{counts[c]}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Field orientation="horizontal" className="w-fit">
            <Switch id="show-hidden" size="sm" checked={showHidden} onCheckedChange={setShowHidden} />
            <FieldLabel htmlFor="show-hidden">Show hidden</FieldLabel>
          </Field>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <PackageOpenIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing here</EmptyTitle>
                <EmptyDescription>You don't own any {CATEGORIES[category].toLowerCase()} yet.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,4.5rem)] gap-2 p-1">
              {items.map((i) => (
                <Tooltip key={i.id}>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => setSelectedId(i.id)}
                        style={i.quality ? { borderColor: QUALITY_COLORS[i.quality] } : undefined}
                        className={cn(
                          "relative flex size-18 items-center justify-center rounded-lg border-2 bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                          !i.quality && "border-border",
                          i.id === selectedId && "ring-2 ring-ring",
                          prefs.hidden.includes(i.id) && "opacity-50",
                        )}
                      />
                    }
                  >
                    <ItemIcon item={i} className="size-14" />
                    {i.qty > 1 && (
                      <Badge variant="secondary" className="absolute -right-1 -bottom-1 h-4 px-1 text-[10px]">
                        {i.qty}
                      </Badge>
                    )}
                    {prefs.favorites.includes(i.id) && (
                      <StarIcon className="absolute top-0.5 left-0.5 size-3.5 fill-current text-primary" />
                    )}
                    {isEquipped(i) && <CheckIcon className="absolute top-0.5 right-0.5 size-3.5 text-primary" />}
                  </TooltipTrigger>
                  <TooltipContent>{i.name}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      <aside className="flex w-56 shrink-0 flex-col gap-3 rounded-lg border p-3">
        {selected ? (
          <Details item={selected} />
        ) : (
          <p className="m-auto text-center text-sm text-muted-foreground">Select an item</p>
        )}
      </aside>
    </div>
  );

  function Details({ item }: { item: Item }) {
    const fav = prefs.favorites.includes(item.id);
    const hid = prefs.hidden.includes(item.id);
    const equipSlot = item.slot === "hat" || item.slot === "skin" || item.slot === "bongos" ? item.slot : null;
    const wheelSlot = item.slot === "emote" || item.slot === "consumable";
    const inWheel = prefs.emotes.includes(item.id);
    const wheelFull = !inWheel && prefs.emotes.length >= MAX_WHEEL_EMOTES;
    const equipped = equipSlot ? prefs.equipped[equipSlot] === item.id : false;
    return (
      <>
        <ItemIcon key={item.id} item={item} className="mx-auto size-24" />
        <div className="flex flex-col gap-1.5">
          <h3 className="text-base font-semibold" style={{ color: item.color }}>
            {item.name}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.quality && (
              <Badge variant="outline" style={{ color: QUALITY_COLORS[item.quality], borderColor: QUALITY_COLORS[item.quality] }}>
                {item.quality}
              </Badge>
            )}
            {item.slot && <Badge variant="secondary">{item.slot}</Badge>}
            {item.event && <Badge variant="secondary">{item.event}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">Owned: {item.qty}</p>
        </div>
        <div className="mt-auto flex flex-col gap-2">
          {equipSlot && (
            <Button
              onClick={() => {
                const { [equipSlot]: _, ...rest } = prefs.equipped;
                update({ equipped: equipped ? rest : { ...prefs.equipped, [equipSlot]: item.id } });
              }}
            >
              {equipped ? "Unequip" : "Equip"}
            </Button>
          )}
          {wheelSlot && (
            <>
              <Button
                disabled={wheelFull}
                onClick={() => update({ emotes: toggle(prefs.emotes, item.id) })}
              >
                {inWheel ? "Remove from wheel" : "Add to wheel"}
              </Button>
              {wheelFull && (
                <p className="text-xs text-muted-foreground">Wheel is full ({MAX_WHEEL_EMOTES}).</p>
              )}
            </>
          )}
          <Button variant="outline" onClick={() => update({ favorites: toggle(prefs.favorites, item.id) })}>
            <StarIcon data-icon="inline-start" />
            {fav ? "Unfavorite" : "Favorite"}
          </Button>
          <Button variant="outline" onClick={() => update({ hidden: toggle(prefs.hidden, item.id) })}>
            <EyeOffIcon data-icon="inline-start" />
            {hid ? "Unhide" : "Hide"}
          </Button>
        </div>
      </>
    );
  }
}
