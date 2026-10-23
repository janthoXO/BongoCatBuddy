import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clock, Gift, Loader2, PawPrint, Smile } from "lucide-react";
import { CHEST_PRICE } from "@/lib/items";
import type { Prefs } from "@/lib/prefs";

const KEYS = { cosmetic: "TIME_LEFT", emote: "EMOTE_CHEST_TIME_LEFT" };
const FULL = 1800;
const RETRY = 60;

function load(key: string) {
  try {
    const n = Number(localStorage.getItem(key));
    return n > 0 ? Math.min(n, FULL) : FULL;
  } catch {
    return FULL;
  }
}

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * One chest shop bubble with its restock timer. `tokens` is null until the catalog is known.
 * When `gift` changes, another player paid for this chest: it opens for free if it is ready.
 */
export default function Chest({
  kind, tokens, score, prefs, onWon, onReady, gift, style,
}: {
  kind: "cosmetic" | "emote";
  tokens: number | null;
  score: number | null;
  prefs: Prefs;
  onWon: (id: number) => void;
  onReady: (ready: boolean) => void;
  gift: number;
  style: CSSProperties;
}) {
  const key = KEYS[kind];
  const [t, setT] = useState(() => load(key));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fx, setFx] = useState(0); // >0 while the purchase animation plays

  useEffect(() => {
    if (ready || tokens === null) return;
    try {
      localStorage.setItem(key, String(t));
    } catch {
      // storage unavailable
    }
    if (t <= 0) {
      if (tokens > 0) setReady(true);
      else setT(RETRY);
      return;
    }
    const id = setTimeout(() => setT((v) => v - 1), 1000);
    return () => clearTimeout(id);
  }, [t, ready, tokens, key]);

  useEffect(() => {
    onReady(ready && !busy);
  }, [ready, busy]);

  const open = async (gift: boolean) => {
    setBusy(true);
    try {
      const id = await invoke<number>("open_chest", { kind, gift });
      setT(FULL);
      setReady(false);
      onWon(id);
      if (prefs.animateChestPurchase) {
        setFx((n) => n + 1);
        setTimeout(() => setFx(0), 1200);
      }
    } catch (e) {
      setT(RETRY);
      setReady(false);
      setErr(String(e));
      setTimeout(() => setErr(null), 3000);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (gift && ready && !busy) void open(true);
  }, [gift]);

  const visible = (ready && prefs.showChestPopup) || prefs.alwaysShowChest || fx > 0;
  if (!visible) return null;
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
  const title = ready && !afford ? `Need ${CHEST_PRICE} taps` : emote ? "Emote chest" : "Cosmetic chest";

  return (
    <div className="absolute flex flex-col items-center" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={click}
        title={title}
        className={`relative flex size-11 items-center justify-center rounded-full border-2 border-outline text-foreground shadow-sticker-sm ${
          emote ? "bg-secondary" : "bg-card"
        } ${ready && !afford ? "opacity-60 grayscale" : ""} ${shake ? "chest-shake" : ""} ${fx ? "chest-pop" : ""}`}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" />
        ) : ready ? (
          <Gift className="chest-idle size-6 text-primary" />
        ) : (
          <span className="flex flex-col items-center gap-px font-heading text-[10px] leading-none tabular-nums text-muted-foreground">
            <Clock className="size-3" />
            {mmss(t)}
          </span>
        )}
        {emote && (
          <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border-2 border-outline bg-card">
            <Smile className="size-2.5" />
          </span>
        )}
        {fx > 0 && (
          <span className="chest-float pointer-events-none absolute -top-3 font-heading text-xs font-bold text-destructive">
            -{CHEST_PRICE}
          </span>
        )}
      </button>
      {ready && !busy && (
        <span
          className={`-mt-2 flex items-center gap-0.5 rounded-full border-2 border-outline bg-card px-1.5 font-heading text-[10px] leading-4 tabular-nums ${
            afford ? "" : "opacity-60 grayscale"
          }`}
        >
          {CHEST_PRICE}
          <PawPrint className="size-2.5 text-primary" />
        </span>
      )}
      {err && (
        <p className="mt-0.5 max-w-24 break-words rounded-full border-2 border-destructive bg-card px-1.5 text-center text-[10px] leading-tight text-destructive">
          {err}
        </p>
      )}
    </div>
  );
}
