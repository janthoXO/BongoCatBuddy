import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
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
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && void getCurrentWindow().hide();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);

  return (
    <TooltipProvider>
      <main className="flex h-svh flex-col overflow-hidden rounded-xl border bg-background p-3 text-foreground">
        <Tabs defaultValue="inventory" className="min-h-0 flex-1 gap-3">
          <TabsList className="w-full rounded-lg bg-muted p-0.5 group-data-horizontal/tabs:h-8">
            {TABS.map(([v, label]) => (
              <TabsTrigger key={v} value={v} className="rounded-md text-sm after:hidden data-active:bg-card data-active:shadow-sm">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map(([v, , Tab]) => (
            <TabsContent key={v} value={v} className="flex min-h-0 flex-col">
              <Tab />
            </TabsContent>
          ))}
        </Tabs>
        <Toaster />
      </main>
    </TooltipProvider>
  );
}
