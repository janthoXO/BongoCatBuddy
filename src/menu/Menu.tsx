import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { onShowItem } from "@/lib/items";
import { Crafting } from "./Crafting";
import { Inventory } from "./Inventory";
import { Lobby } from "./Lobby";
import { Settings } from "./Settings";

const TABS = [
  ["inventory", "Items", Inventory],
  ["crafting", "Craft", Crafting],
  ["lobby", "Lobby", Lobby],
  ["settings", "Settings", Settings],
] as const;

/** The tray panel (see `show_menu` in lib.rs): hides on blur, and on Escape. */
export default function Menu() {
  const [tab, setTab] = useState<string>("inventory");
  // an item to show (overlay popup clicked); `k` so the same item twice still counts
  const [focus, setFocus] = useState<{ id: number; k: number } | null>(null);
  useEffect(() => {
    const un = onShowItem((id) => {
      setTab("inventory");
      setFocus((f) => ({ id, k: (f?.k ?? 0) + 1 }));
    });
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && void getCurrentWindow().hide();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  return (
    <TooltipProvider>
      <main className="flex h-svh flex-col overflow-hidden rounded-xl border bg-background p-3 text-foreground">
        <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="min-h-0 flex-1 gap-3">
          <TabsList className="w-full rounded-lg bg-muted p-0.5 group-data-horizontal/tabs:h-8">
            {TABS.map(([v, label]) => (
              <TabsTrigger key={v} value={v} className="rounded-md text-sm after:hidden data-active:bg-card data-active:shadow-sm">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map(([v, , Tab]) => (
            <TabsContent key={v} value={v} className="flex min-h-0 flex-col">
              {v === "inventory" ? <Inventory focus={focus} /> : <Tab />}
            </TabsContent>
          ))}
        </Tabs>
        <Toaster />
      </main>
    </TooltipProvider>
  );
}
