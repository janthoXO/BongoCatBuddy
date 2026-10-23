import { useEffect, useState } from "react";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CAT_SCALES, usePrefs, type Prefs } from "@/lib/prefs";

type BoolKey = { [K in keyof Prefs]: Prefs[K] extends boolean ? K : never }[keyof Prefs];

const SECTIONS: { title: string; rows: [BoolKey, string][] }[] = [
  {
    title: "Cat",
    rows: [
      ["alwaysOnTop", "Always on top"],
      ["lockPosition", "Lock cat position"],
      ["flip", "Flip cat"],
      ["ignoreMouse", "Mouse clicks don't count"],
      ["hideCounter", "Only show score on hover"],
      ["catBobbing", "Cat bobbing"],
    ],
  },
  {
    title: "Chests",
    rows: [
      ["showChestPopup", "Pop up chest when ready"],
      ["alwaysShowChest", "Always show chests"],
      ["showEmoteChest", "Show emote chest"],
      ["animateChestPurchase", "Animate chest purchase"],
    ],
  },
  {
    title: "Emotes",
    rows: [
      ["autoEquipDrops", "Auto-equip new cosmetics"],
      ["showEmoteWheel", "Show emote wheel"],
    ],
  },
  {
    title: "Crafting",
    rows: [
      ["craftAllowFavorites", "Crafting: allow favorites"],
      ["craftExcludeEvent", "Crafting: exclude event items"],
    ],
  },
];

const SCALE_ITEMS = CAT_SCALES.map((s) => ({ value: String(s), label: `${Math.round(s * 100)}%` }));

export function Settings() {
  const [prefs, update] = usePrefs();
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => {});
  }, []);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <FieldGroup className="p-1 pr-3">
        {SECTIONS.map((s) => (
          <FieldSet key={s.title}>
            <FieldLegend variant="label">{s.title}</FieldLegend>
            <FieldGroup className="gap-3">
              {s.title === "Cat" && (
                <Field orientation="horizontal">
                  <FieldLabel>Cat size</FieldLabel>
                  <Select
                    items={SCALE_ITEMS}
                    value={String(prefs.catScale)}
                    onValueChange={(v) => v && update({ catScale: Number(v) })}
                  >
                    <SelectTrigger className="ml-auto w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCALE_ITEMS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {s.rows.map(([key, label]) => (
                <Field key={key} orientation="horizontal">
                  <FieldLabel htmlFor={key}>{label}</FieldLabel>
                  <Switch id={key} className="ml-auto" checked={prefs[key]} onCheckedChange={(v) => update({ [key]: v })} />
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
        ))}
        <FieldSet>
          <FieldLegend variant="label">System</FieldLegend>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="autostart">Start with system</FieldLabel>
            <Switch
              id="autostart"
              className="ml-auto"
              checked={autostart}
              onCheckedChange={(v) => {
                setAutostart(v);
                (v ? enable() : disable()).catch(() => setAutostart(!v));
              }}
            />
          </Field>
        </FieldSet>
      </FieldGroup>
    </ScrollArea>
  );
}
