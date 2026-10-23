import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { GiftIcon, PawPrintIcon, SmileIcon } from "lucide-react";
import { CatFigure } from "@/components/CatFigure";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CHEST_TOKEN, EMOTE_CHEST_TOKEN, useItems } from "@/lib/items";
import { usePrefs } from "@/lib/prefs";
import { Crafting } from "./Crafting";
import { Inventory } from "./Inventory";
import { Settings } from "./Settings";

type Score = { current: number; lifetime: number };
const fmt = (n: number) => n.toLocaleString("en-US").replace(/,/g, " ");

function Chip({ icon, value, tip }: { icon: ReactNode; value: string; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex h-8 items-center gap-1.5 rounded-full border-2 border-outline bg-card px-3 text-sm font-semibold tabular-nums shadow-sticker-sm [&_svg]:size-4 [&_svg]:text-primary" />
        }
      >
        {icon}
        {value}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

const tabClass =
  "h-9 flex-none rounded-full px-4 font-heading text-sm text-foreground/70 after:hidden data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sticker-sm";

export default function Menu() {
  const { catalog } = useItems();
  const [prefs] = usePrefs();
  const [score, setScore] = useState<Score | null>(null);
  useEffect(() => {
    invoke<Score | null>("get_score").then((s) => s && setScore(s)).catch(() => {});
    const un = listen<Score>("score", (e) => setScore(e.payload));
    return () => void un.then((f) => f());
  }, []);

  const worn = (slot: "hat" | "skin") => {
    const it = catalog?.get(prefs.equipped[slot] ?? -1);
    return it && it.qty > 0 ? it : undefined;
  };

  return (
    <TooltipProvider>
      <main className="flex h-svh flex-col gap-3 bg-background p-4 text-foreground">
        <header className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CatFigure unit={0.32} hat={worn("hat")} skin={worn("skin")} />
            <h1 className="font-heading text-xl font-semibold">BongoCatBuddy</h1>
          </div>
          <div className="flex items-center gap-2">
            <Chip icon={<PawPrintIcon />} value={score ? fmt(score.current) : "..."} tip="Taps" />
            <Chip icon={<GiftIcon />} value={String(catalog?.get(CHEST_TOKEN)?.qty ?? 0)} tip="Chest tokens" />
            <Chip icon={<SmileIcon />} value={String(catalog?.get(EMOTE_CHEST_TOKEN)?.qty ?? 0)} tip="Emote chest tokens" />
          </div>
        </header>
        <Tabs defaultValue="inventory" className="min-h-0 flex-1 gap-3">
          <TabsList className="group-data-horizontal/tabs:h-auto w-fit gap-1 rounded-full border-2 border-border bg-card p-1">
            <TabsTrigger value="inventory" className={tabClass}>Inventory</TabsTrigger>
            <TabsTrigger value="crafting" className={tabClass}>Crafting</TabsTrigger>
            <TabsTrigger value="settings" className={tabClass}>Settings</TabsTrigger>
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
