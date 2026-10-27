import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Gift, Loader2, Smile } from "lucide-react";
import { CHEST_PRICE } from "@/lib/items";

/**
 * One chest shop bubble, shown while the player has a token of that kind (`tokens` is null until
 * the catalog is known).
 * When `gift` changes, another player paid for this chest: it opens for free if it is ready.
 */
export default function Chest({
  kind, tokens, score, onWon, onReady, gift,
}: {
  kind: "cosmetic" | "emote";
  tokens: number | null;
  score: number | null;
  onWon: (id: number) => void;
  onReady: (ready: boolean) => void;
  gift: number;
}) {
  const ready = (tokens ?? 0) > 0;
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fx, setFx] = useState(0); // >0 while the purchase animation plays

  useEffect(() => {
    onReady(ready && !busy);
  }, [ready, busy]);

  const open = async (gift: boolean) => {
    setBusy(true);
    try {
      const id = await invoke<number>("open_chest", { kind, gift });
      onWon(id);
      setFx((n) => n + 1);
      setTimeout(() => setFx(0), 1200);
    } catch (e) {
      setErr(String(e));
      setTimeout(() => setErr(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (gift && ready && !busy) void open(true);
  }, [gift]);

  if (!ready && !fx && !err) return null;
  const afford = score !== null && score >= CHEST_PRICE;

  const click = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy || !ready) return;
    if (!afford) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    void open(false);
  };

  const emote = kind === "emote";
  const title = `${emote ? "Emote chest" : "Chest"}: ${afford ? "open" : "need"} ${CHEST_PRICE} taps`;
  const Icon = emote ? Smile : Gift;

  // A small pill in the score row; can't afford = dimmed (the price is in the tooltip).
  return (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
      {(ready || fx > 0) && (
        <button
          type="button"
          onClick={click}
          title={title}
          className={`pill flex size-6 items-center justify-center ${afford ? "" : "opacity-50"} ${shake ? "chest-shake" : ""} ${fx ? "chest-pop" : ""}`}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5 text-primary" />}
        </button>
      )}
      {fx > 0 && (
        <span className="chest-float pointer-events-none absolute -top-4 left-1/2 -translate-x-1/2 text-xs font-semibold text-destructive">
          -{CHEST_PRICE}
        </span>
      )}
      {err && (
        <p className="pill absolute top-full left-1/2 z-10 mt-1 w-32 -translate-x-1/2 rounded-xl px-1.5 text-center text-[10px] leading-tight text-destructive">
          {err}
        </p>
      )}
    </div>
  );
}
