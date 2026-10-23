import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Gift, Loader2 } from "lucide-react";
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

/** One chest shop bubble with its restock timer. `tokens` is null until the catalog is known. */
export default function Chest({
  kind, tokens, score, prefs, onWon, style,
}: {
  kind: "cosmetic" | "emote";
  tokens: number | null;
  score: number | null;
  prefs: Prefs;
  onWon: (id: number) => void;
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

  const visible = (ready && prefs.showChestPopup) || prefs.alwaysShowChest || fx > 0;
  if (!visible) return null;
  const afford = score !== null && score >= CHEST_PRICE;

  const click = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy || !ready) return;
    if (!afford) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    setBusy(true);
    try {
      const id = await invoke<number>("open_chest", { kind });
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

  return (
    <div className="absolute flex flex-col items-center" style={style} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={click}
        title={kind === "emote" ? "Emote chest" : "Cosmetic chest"}
        className={`relative flex size-12 flex-col items-center justify-center rounded-full border border-border bg-background/80 text-xs font-medium tabular-nums text-foreground ${
          ready && !afford ? "opacity-50" : ""
        } ${shake ? "chest-shake" : ""} ${fx ? "chest-pop" : ""}`}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : ready ? (
          <>
            <Gift className="size-4" />
            <span className="text-[10px] leading-none">{CHEST_PRICE}</span>
          </>
        ) : (
          mmss(t)
        )}
        {fx > 0 && (
          <span className="chest-float pointer-events-none absolute -top-2 text-xs font-bold text-red-500">
            -{CHEST_PRICE}
          </span>
        )}
      </button>
      {err && <p className="mt-0.5 w-14 break-words text-center text-[10px] leading-tight text-red-500">{err}</p>}
    </div>
  );
}
