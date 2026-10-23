import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CHEST_TOKEN, EMOTE_CHEST_TOKEN, useItems } from "@/lib/items";
import { Crafting } from "./Crafting";
import { Inventory } from "./Inventory";
import { Settings } from "./Settings";

type Score = { current: number; lifetime: number };
const fmt = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

export default function Menu() {
  const { catalog } = useItems();
  const [score, setScore] = useState<Score | null>(null);
  useEffect(() => {
    invoke<Score | null>("get_score").then((s) => s && setScore(s)).catch(() => {});
    const un = listen<Score>("score", (e) => setScore(e.payload));
    return () => void un.then((f) => f());
  }, []);

  return (
    <TooltipProvider>
      <main className="flex h-svh flex-col gap-3 bg-background p-4 text-foreground">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>Taps: {score ? fmt(score.current) : "..."}</span>
          <span className="text-muted-foreground">Chest tokens: {catalog?.get(CHEST_TOKEN)?.qty ?? 0}</span>
          <span className="text-muted-foreground">Emote chest tokens: {catalog?.get(EMOTE_CHEST_TOKEN)?.qty ?? 0}</span>
        </header>
        <Tabs defaultValue="inventory" className="min-h-0 flex-1">
          <TabsList>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="crafting">Crafting</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="inventory" className="flex min-h-0 flex-col">
            <Inventory />
          </TabsContent>
          <TabsContent value="crafting" className="flex min-h-0 flex-col">
            <Crafting />
          </TabsContent>
          <TabsContent value="settings" className="flex min-h-0 flex-col">
            <Settings />
          </TabsContent>
        </Tabs>
        <Toaster />
      </main>
    </TooltipProvider>
  );
}
