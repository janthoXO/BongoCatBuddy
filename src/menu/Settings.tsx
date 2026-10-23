import { useEffect, useState, type ComponentType } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { CatIcon, GiftIcon, HammerIcon, MonitorIcon, SmileIcon } from "lucide-react";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CAT_SCALES, usePrefs, type Prefs } from "@/lib/prefs";

type BoolKey = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs];

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
  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => {});
  }, []);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-1 pr-3">
        {SECTIONS.map((s) => (
          <Card key={s.title} title={s.title} icon={s.icon}>
            {s.title === "Cat" && (
              <Field>
                <FieldLabel>Cat size</FieldLabel>
                <ToggleGroup
                  spacing={1}
                  value={[String(prefs.catScale)]}
                  onValueChange={(v) => v[0] && update({ catScale: Number(v[0]) })}
                  className="flex-wrap"
                >
                  {CAT_SCALES.map((c) => (
                    <ToggleGroupItem
                      key={c}
                      value={String(c)}
                      className="h-8 rounded-full border-2 border-border px-3 font-heading tabular-nums aria-pressed:border-outline aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:shadow-sticker-sm aria-pressed:hover:bg-primary"
                    >
                      {Math.round(c * 100)}%
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
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
