import { useEffect, useState, type ReactNode } from "react";
import { availableMonitors, primaryMonitor } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CAT_SCALE, MAX_CATS, usePrefs, type Prefs } from "@/lib/prefs";

/** One line of a grouped list: label left, control right. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-1.5 text-sm">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label}>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </Row>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <Row label={label}>
      <ToggleGroup value={[value]} onValueChange={(v) => v[0] && onChange(v[0])} className="flex-wrap justify-end rounded-lg bg-muted p-0.5">
        {options.map(([v, text]) => (
          <ToggleGroupItem key={v} value={v} className="h-7 rounded-md px-3 text-sm aria-pressed:bg-card dark:aria-pressed:bg-white/15 aria-pressed:shadow-sm">
            {text}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Row>
  );
}

function Range({ label, range, value, format, onCommit }: { label: string; range: { min: number; max: number; step: number }; value: number; format: (v: number) => string; onCommit: (v: number) => void }) {
  // shown value follows the drag; the pref only changes on release so the overlay doesn't resize every tick
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  const one = (v: number | readonly number[]) => (typeof v === "number" ? v : v[0]);
  return (
    <Row label={label}>
      <div className="flex w-44 items-center gap-3">
        <Slider {...range} value={shown} onValueChange={(v) => setShown(one(v))} onValueCommitted={(v) => onCommit(one(v))} />
        <span className="w-10 text-right text-muted-foreground tabular-nums">{format(shown)}</span>
      </div>
    </Row>
  );
}

const OUTFIT_EVERY: Record<string, string> = { "0": "Off", "15": "Every 15 min", "30": "Every 30 min", "60": "Every hour" };

function Section({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      <div className="divide-y divide-border rounded-xl bg-card">{children}</div>
      {footer && <p className="px-4 text-xs text-muted-foreground">{footer}</p>}
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
  const set = (key: keyof Prefs) => (v: boolean) => update({ [key]: v });

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-6 p-1 pr-3 pb-4">
        <Section title="Cat" footer="Click your cat to show or hide the score and name tags. Right-click it to open this menu. Random outfit skips hidden items.">
          <Range label="Size" range={CAT_SCALE} value={prefs.catScale} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => update({ catScale: v })} />
          {screens.length > 1 && (
            <Choice
              label="Screen"
              value={prefs.monitor && screens.includes(prefs.monitor) ? prefs.monitor : screens[0]}
              options={screens.map((n) => [n, n])}
              onChange={(v) => update({ monitor: v })}
            />
          )}
          <Toggle label="Flip" checked={prefs.flip} onChange={set("flip")} />
          <Toggle label="Lock position" checked={prefs.lockPosition} onChange={set("lockPosition")} />
          <Toggle label="Count mouse clicks" checked={!prefs.ignoreMouse} onChange={(v) => update({ ignoreMouse: !v })} />
          <Toggle label="Wear new hats and skins" checked={prefs.autoEquipDrops} onChange={set("autoEquipDrops")} />
          <Row label="Random outfit">
            <Select items={OUTFIT_EVERY} value={String(prefs.randomOutfit)} onValueChange={(v) => update({ randomOutfit: Number(v) })}>
              <SelectTrigger size="sm" aria-label="Random outfit" className="border-0 bg-muted dark:bg-muted">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OUTFIT_EVERY).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          {prefs.randomOutfit > 0 && <Toggle label="Only favorites" checked={prefs.randomFavorites} onChange={set("randomFavorites")} />}
        </Section>

        <Section title="Multiplayer" footer="Drag players in the Lobby tab to set their order.">
          <Choice
            label="Layout"
            value={prefs.catLayout}
            options={[["row", "Row"], ["column", "Column"], ["free", "Free"]]}
            onChange={(v) => update({ catLayout: v as Prefs["catLayout"] })}
          />
          <Range label="Max cats" range={MAX_CATS} value={prefs.maxCats} format={String} onCommit={(v) => update({ maxCats: v })} />
          <Toggle label="Rejoin last lobby" checked={prefs.joinLastLobby} onChange={set("joinLastLobby")} />
          <Toggle label="Chat bubbles" checked={!prefs.muteChats} onChange={(v) => update({ muteChats: !v })} />
          <Toggle label="Pats" checked={prefs.receivePats} onChange={set("receivePats")} />
          <Toggle label="Others' new items" checked={prefs.multiplayerPopups} onChange={set("multiplayerPopups")} />
        </Section>

        <Section title="System" footer="Attach the log file to bug reports.">
          <Toggle
            label="Start with system"
            checked={autostart}
            onChange={(v) => {
              setAutostart(v);
              (v ? enable() : disable()).catch(() => setAutostart(!v));
            }}
          />
          <Row label="Log file">
            <Button variant="secondary" size="sm" onClick={() => invoke("open_logs").catch(() => {})}>
              Show log file
            </Button>
          </Row>
        </Section>
      </div>
    </ScrollArea>
  );
}
