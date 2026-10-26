import { useEffect, useState, type ComponentType } from "react";
import { availableMonitors, primaryMonitor } from "@tauri-apps/api/window";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { CatIcon, GiftIcon, HammerIcon, MonitorIcon, SmileIcon, UsersIcon } from "lucide-react";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CAT_SCALE, MAX_CATS, usePrefs, type Prefs } from "@/lib/prefs";

type BoolKey = { [K in keyof Prefs]-?: Prefs[K] extends boolean ? K : never }[keyof Prefs];

const SECTIONS: { title: string; icon: ComponentType<{ className?: string }>; rows: [BoolKey, string, string][] }[] = [
  {
    title: "Cat",
    icon: CatIcon,
    rows: [
      ["alwaysOnTop", "Always on top", "Keep the cat above other windows."],
      ["lockPosition", "Lock cat position", "Stop the cat from being dragged around."],
      ["flip", "Flip cat", "Mirror the cat horizontally."],
      ["ignoreMouse", "Mouse clicks don't count", "Only keyboard presses count as taps."],
      ["hideCounter", "Only show score on hover", "Hide the tap counter until you point at the cat."],
      ["catBobbing", "Cat bobbing", "Let the cat bounce along while you type."],
    ],
  },
  {
    title: "Chests",
    icon: GiftIcon,
    rows: [
      ["showChestPopup", "Pop up chest when ready", "Show the chest as soon as you can open it."],
      ["alwaysShowChest", "Always show chests", "Keep the chests and their timers visible."],
      ["showEmoteChest", "Show emote chest", "Include the emote chest next to the cat."],
      ["animateChestPurchase", "Animate chest purchase", "Play the opening animation when you buy a chest."],
    ],
  },
  {
    title: "Emotes",
    icon: SmileIcon,
    rows: [
      ["autoEquipDrops", "Auto-equip new cosmetics", "Wear new hats and skins as soon as they drop."],
      ["showEmoteWheel", "Show emote wheel", "Show the wheel of your favorite emotes."],
    ],
  },
  {
    title: "Multiplayer",
    icon: UsersIcon,
    rows: [
      ["joinLastLobby", "Rejoin last lobby", "Join the lobby you were in when the app starts."],
      ["showPlayerNames", "Show player names", "Show a name tag under other players' cats."],
      ["multiplayerPopups", "Show others' new items", "Pop up what other players get from chests."],
      ["receivePats", "Receive pats", "React when other players pat your cat."],
      ["muteChats", "Mute chat bubbles", "Hide speech bubbles from other players."],
    ],
  },
  {
    title: "Crafting",
    icon: HammerIcon,
    rows: [
      ["craftAllowFavorites", "Allow favorites", "Let Fill duplicates use items you starred."],
      ["craftExcludeEvent", "Exclude event items", "Never auto-fill limited event items."],
    ],
  },
];

function Row({ id, label, desc, checked, onChange }: { id: string; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{desc}</FieldDescription>
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </Field>
  );
}

const chipClass =
  "h-8 rounded-full border-2 border-border px-3 font-heading tabular-nums aria-pressed:border-outline aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:shadow-sticker-sm aria-pressed:hover:bg-primary";

function Choice({ label, desc, value, options, onChange }: { label: string; desc?: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      {desc && <FieldDescription>{desc}</FieldDescription>}
      <ToggleGroup spacing={1} value={[value]} onValueChange={(v) => v[0] && onChange(v[0])} className="flex-wrap">
        {options.map(([v, text]) => (
          <ToggleGroupItem key={v} value={v} className={chipClass}>
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Range({ label, range, value, format, onCommit }: { label: string; range: { min: number; max: number; step: number }; value: number; format: (v: number) => string; onCommit: (v: number) => void }) {
  // shown value follows the drag; the pref only changes on release so the overlay doesn't resize every tick
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  const one = (v: number | readonly number[]) => (typeof v === "number" ? v : v[0]);
  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        <span className="font-heading tabular-nums">{format(shown)}</span>
      </div>
      <Slider {...range} value={shown} onValueChange={(v) => setShown(one(v))} onValueCommitted={(v) => onCommit(one(v))} />
    </Field>
  );
}

function Card({ title, icon: Icon, children }: { title: string; icon: ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border-2 border-border bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold">
        <span className="flex size-7 items-center justify-center rounded-full bg-secondary">
          <Icon className="size-4 text-primary" />
        </span>
        {title}
      </h2>
      <FieldGroup className="gap-3">{children}</FieldGroup>
    </section>
  );
}

export function Settings() {
  const [prefs, update] = usePrefs();
  const [autostart, setAutostart] = useState(false);
  // monitor names, the primary one first
  const [screens, setScreens] = useState<string[]>([]);
  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => {});
    Promise.all([availableMonitors(), primaryMonitor()])
      .then(([all, p]) => setScreens(all.map((m) => m.name ?? "").filter(Boolean).sort((a) => (a === p?.name ? -1 : 0))))
      .catch(() => {});
  }, []);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-1 pr-3">
        {SECTIONS.map((s) => (
          <Card key={s.title} title={s.title} icon={s.icon}>
            {s.title === "Cat" && (
              <Range label="Cat size" range={CAT_SCALE} value={prefs.catScale} format={pct} onCommit={(v) => update({ catScale: v })} />
            )}
            {s.title === "Cat" && screens.length > 1 && (
              <Choice
                label="Screen"
                desc="The screen your cat and the other cats live on."
                value={prefs.monitor && screens.includes(prefs.monitor) ? prefs.monitor : screens[0]}
                options={screens.map((n) => [n, n])}
                onChange={(v) => update({ monitor: v })}
              />
            )}
            {s.title === "Multiplayer" && (
              <>
                <Choice
                  label="Cat layout"
                  desc={prefs.catLayout === "row" ? "Other cats line up next to yours and follow it." : "Drag every cat on its own; they remember their spot."}
                  value={prefs.catLayout}
                  options={[["row", "Row"], ["free", "Free"]]}
                  onChange={(v) => update({ catLayout: v as Prefs["catLayout"] })}
                />
                <Range label="Other cats' size" range={CAT_SCALE} value={prefs.remoteCatScale} format={pct} onCommit={(v) => update({ remoteCatScale: v })} />
                <Range label="Max cats shown" range={MAX_CATS} value={prefs.maxCats} format={String} onCommit={(v) => update({ maxCats: v })} />
              </>
            )}
            {s.rows.map(([key, label, desc]) => (
              <Row key={key} id={key} label={label} desc={desc} checked={prefs[key]} onChange={(v) => update({ [key]: v })} />
            ))}
          </Card>
        ))}
        <Card title="System" icon={MonitorIcon}>
          <Row
            id="autostart"
            label="Start with system"
            desc="Launch BongoCatBuddy when you log in."
            checked={autostart}
            onChange={(v) => {
              setAutostart(v);
              (v ? enable() : disable()).catch(() => setAutostart(!v));
            }}
          />
        </Card>
      </div>
    </ScrollArea>
  );
}
