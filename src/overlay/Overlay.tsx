import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { Menu, PawPrint } from "lucide-react";
import { useItems, artUrl, CHEST_TOKEN, EMOTE_CHEST_TOKEN, iconUrl, QUALITY_COLORS, type Item } from "@/lib/items";
import { MAX_WHEEL_EMOTES, usePrefs } from "@/lib/prefs";
import Chest from "./Chest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CatFigure, FIGURE_H, FIGURE_W } from "@/components/CatFigure";

const UNIT = 1.25; // px per unit at catScale 1
const HIT_MS = 100;

// Cat box in units = the figure (see CatFigure).
const BOX_W = FIGURE_W;
const BOX_H = FIGURE_H;
// Fixed px (not scaled) around the cat box.
const SIDE = 30; // each side margin; the chests sit in the score row, outside the cat
const TOP = 0; // nothing reserved above the box: the popup and wheel overlap its empty hat area
const WHEEL_R = 66;
const WHEEL_CY = 100; // wheel arc center, below the box top (around the head)
const WHEEL_W = 2 * WHEEL_R + 26;
const CHEST_H = 52; // bubble + price chip
const BOTTOM = CHEST_H + 6; // score row with the chests on both ends (+ notice)

export const layout = (scale: number) => {
  const u = UNIT * scale;
  const boxW = BOX_W * u;
  const boxH = BOX_H * u;
  return {
    u, boxW, boxH,
    w: Math.ceil(Math.max(boxW + 2 * SIDE, WHEEL_W)),
    h: Math.ceil(TOP + boxH + BOTTOM),
  };
};

type Score = { current: number; lifetime: number };


type Particle = { k: number; item: Item };
type Won = { k: number; id: number };

function EmoteParticle({ item, left, top }: { item: Item; left: number; top: number }) {
  const [src, setSrc] = useState(artUrl(item));
  return (
    <img
      src={src}
      onError={() => setSrc(iconUrl(item))}
      draggable={false}
      className="emote-float pointer-events-none absolute z-30 size-16"
      style={{ left, top }}
    />
  );
}

export default function Overlay() {
  const [prefs, update] = usePrefs();
  const { catalog } = useItems();
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const [wheel, setWheel] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [queue, setQueue] = useState<Won[]>([]);
  const wasLeft = useRef(false);
  const punching = useRef({ left: false, right: false });
  const seq = useRef(0);

  const owned = (id?: number) => {
    const it = id === undefined ? undefined : catalog?.get(id);
    return it && it.qty > 0 ? it : undefined;
  };
  const skin = owned(prefs.equipped.skin);
  const hatItem = owned(prefs.equipped.hat);

  const L = layout(prefs.catScale);

  useEffect(() => {
    void getCurrentWindow().setSize(new LogicalSize(L.w, L.h)).catch(() => {});
  }, [L.w, L.h]);
  useEffect(() => {
    void getCurrentWindow().setAlwaysOnTop(prefs.alwaysOnTop).catch(() => {});
  }, [prefs.alwaysOnTop]);
  useEffect(() => {
    invoke("set_ignore_mouse", { ignore: prefs.ignoreMouse }).catch(() => {});
  }, [prefs.ignoreMouse]);

  useEffect(() => {
    invoke<Score | null>("get_score").then(setScore).catch(() => {});
    invoke<string | null>("get_notice").then(setError).catch(() => {});

    const punch = (side: "left" | "right") => {
      if (punching.current[side]) return;
      punching.current[side] = true;
      (side === "left" ? setLeft : setRight)(true);
      setTimeout(() => {
        punching.current[side] = false;
        (side === "left" ? setLeft : setRight)(false);
      }, HIT_MS);
    };
    const unlisten = [
      listen<Score>("score", (e) => setScore(e.payload)),
      listen<number>("tap", () => {
        punch(wasLeft.current ? "right" : "left");
        wasLeft.current = !wasLeft.current;
      }),
      listen<string>("notice", (e) => setError(e.payload)),
    ];
    return () => unlisten.forEach((p) => p.then((f) => f()));
  }, []);


  const onWon = (id: number) => {
    setQueue((q) => [...q, { k: ++seq.current, id }]);
    const it = catalog?.get(id);
    if (prefs.autoEquipDrops && (it?.slot === "hat" || it?.slot === "skin"))
      update({ equipped: { ...prefs.equipped, [it.slot]: id } });
  };
  const head = queue[0];
  useEffect(() => {
    if (!head) return;
    const id = setTimeout(() => setQueue((q) => q.slice(1)), 4000);
    return () => clearTimeout(id);
  }, [head?.k]);
  const won = head && (catalog?.get(head.id) ?? null);

  const wheelItems = prefs.showEmoteWheel
    ? prefs.emotes
        .map((id) => owned(id))
        .filter((i): i is Item => !!i)
        .slice(0, MAX_WHEEL_EMOTES)
    : [];
  const useEmote = (item: Item) => {
    const k = ++seq.current;
    setParticles((p) => [...p, { k, item }]);
    setTimeout(() => setParticles((p) => p.filter((x) => x.k !== k)), 1500);
    invoke("use_emote", { def: item.id }).catch((e) => {
      setFlash(String(e));
      setTimeout(() => setFlash(null), 3000);
    });
  };

  const boxLeft = (L.w - L.boxW) / 2;
  // Chests flank the score pill under the cat, so they never cover the art.
  const chestTop = TOP + L.boxH + 2;
  const chestX = 4;
  const notice = flash ?? error;
  const openMenu = () => void invoke("open_menu").catch(() => {});

  return (
    <main className="group relative h-svh overflow-hidden" style={{ width: L.w }}>
      <style>{`
        @keyframes bob { 50% { transform: translateY(-4px); } }
        @keyframes emote-float { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-80px); opacity: 0; } }
        @keyframes chest-shake { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
        @keyframes chest-pop { 40% { transform: scale(1.25); } }
        @keyframes chest-float { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-28px); opacity: 0; } }
        @keyframes popup { 0% { transform: translate(-50%, -12px); opacity: 0; } 8%, 92% { transform: translate(-50%, 0); opacity: 1; } 100% { transform: translate(-50%, 0); opacity: 0; } }
        @keyframes wheel-pop { from { transform: scale(0); opacity: 0; } 70% { transform: scale(1.15); } to { transform: scale(1); opacity: 1; } }
        @keyframes chest-idle { 50% { transform: translateY(-2px) rotate(-6deg); } }
        .popup { animation: popup 4s ease-out both; }
        .wheel-pop { animation: wheel-pop 0.25s ease-out both; }
        .chest-idle { animation: chest-idle 1.6s ease-in-out infinite; }
        .bob { animation: bob 2s ease-in-out infinite; }
        .emote-float { animation: emote-float 1.5s ease-out forwards; }
        .chest-shake { animation: chest-shake 0.4s; }
        .chest-pop { animation: chest-pop 0.5s; }
        .chest-float { animation: chest-float 1s ease-out forwards; }
      `}</style>

      {won !== undefined && head && (
        <div
          key={head.k}
          className="popup pointer-events-none absolute left-1/2 top-1 z-20 flex items-center gap-2 overflow-hidden rounded-xl border-2 border-outline bg-card py-1 pl-3 pr-3 shadow-sticker"
          style={{ maxWidth: L.w - 8 }}
        >
          <span
            className="absolute inset-y-0 left-0 w-1.5"
            style={{ background: won?.quality ? QUALITY_COLORS[won.quality] : "var(--border)" }}
          />
          {won ? <PopupIcon item={won} /> : null}
          <div className="min-w-0 leading-tight">
            <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">New item!</p>
            <p className="flex items-center gap-1 text-xs font-semibold text-foreground">
              <span className="truncate font-heading">{won?.name ?? `#${head.id}`}</span>
              {won?.quality && (
                <span className="size-2 shrink-0 rounded-full" style={{ background: QUALITY_COLORS[won.quality] }} />
              )}
            </p>
          </div>
        </div>
      )}

      <div
        className="pointer-events-none absolute left-0"
        style={{ top: 0, width: L.w, height: TOP + L.boxH }}
        onMouseEnter={() => setWheel(true)}
        onMouseLeave={() => setWheel(false)}
      >
        {wheel && wheelItems.length > 0 && (
          <div
            className="pointer-events-auto absolute"
            style={{ left: (L.w - WHEEL_W) / 2, top: TOP + WHEEL_CY - WHEEL_R - 13, width: WHEEL_W, height: WHEEL_R + 26 }}
          >
            {wheelItems.map((it, i) => {
              const th = (Math.PI * (i + 1)) / (wheelItems.length + 1);
              return (
                <button
                  key={it.id}
                  type="button"
                  title={it.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    useEmote(it);
                  }}
                  className="wheel-pop absolute flex size-[26px] items-center justify-center rounded-full border-2 bg-card shadow-sticker-sm"
                  style={{
                    left: WHEEL_W / 2 - WHEEL_R * Math.cos(th) - 13,
                    top: WHEEL_R + 13 - WHEEL_R * Math.sin(th) - 13,
                    animationDelay: `${i * 40}ms`,
                    borderColor: it.quality ? QUALITY_COLORS[it.quality] : "var(--outline)",
                  }}
                >
                  <img src={iconUrl(it)} draggable={false} className="size-4 object-contain" />
                  {it.slot === "consumable" && (
                    <span className="absolute -bottom-1 -right-1 rounded-full border border-outline bg-card px-1 text-[9px] leading-tight tabular-nums">
                      {it.qty}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <div
          className={`pointer-events-auto absolute ${prefs.catBobbing ? "bob" : ""}`}
          style={{ left: boxLeft, top: TOP, width: L.boxW, height: L.boxH }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu();
          }}
        >
          <CatFigure
            {...(prefs.lockPosition ? {} : { "data-tauri-drag-region": true })}
            unit={L.u}
            skin={skin}
            hat={hatItem}
            left={left}
            right={right}
            flip={prefs.flip}
          />
        </div>
      </div>

      <Chest
        kind="cosmetic"
        tokens={catalog ? (catalog.get(CHEST_TOKEN)?.qty ?? 0) : null}
        score={score?.current ?? null}
        prefs={prefs}
        onWon={onWon}
        style={{ left: chestX, top: chestTop }}
      />
      {prefs.showEmoteChest && (
        <Chest
          kind="emote"
          tokens={catalog ? (catalog.get(EMOTE_CHEST_TOKEN)?.qty ?? 0) : null}
          score={score?.current ?? null}
          prefs={prefs}
          onWon={onWon}
          style={{ right: chestX, top: chestTop }}
        />
      )}

      {particles.map((p) => (
        <EmoteParticle key={p.k} item={p.item} left={L.w / 2 - 32} top={TOP + WHEEL_CY - 32} />
      ))}

      <div
        className="absolute left-0 flex flex-col items-center gap-1"
        style={{ top: TOP + L.boxH + 2, width: L.w }}
      >
        <div className="flex items-center gap-1">
          <span
            title={score ? `Lifetime: ${score.lifetime}` : undefined}
            className={`flex items-center gap-1 rounded-full border-2 border-outline bg-card px-2 font-heading text-sm font-semibold leading-5 tabular-nums text-foreground shadow-sticker-sm ${
              prefs.hideCounter ? "opacity-0 group-hover:opacity-100" : ""
            }`}
          >
            <PawPrint className="size-3.5 text-primary" />
            {score ? score.current.toLocaleString("en-US").replace(/,/g, " ") : "…"}
          </span>
          <button
            type="button"
            title="Menu"
            onClick={openMenu}
            className="flex size-6 items-center justify-center rounded-full border-2 border-outline bg-card text-foreground opacity-0 shadow-sticker-sm group-hover:opacity-100"
          >
            <Menu className="size-3" />
          </button>
        </div>
        {notice && (
          <p
            className="max-w-full truncate rounded-full border-2 border-border bg-card px-2 text-center text-[10px] leading-4 text-muted-foreground"
            style={{ maxWidth: L.w - 8 }}
          >
            {notice}
          </p>
        )}
      </div>
    </main>
  );
}

function PopupIcon({ item }: { item: Item }) {
  const [ok, setOk] = useState(true);
  return ok ? (
    <img src={iconUrl(item)} onError={() => setOk(false)} draggable={false} className="size-9 object-contain" />
  ) : (
    <span className="flex size-9 items-center justify-center rounded bg-muted text-xs font-bold">
      {item.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
    </span>
  );
}
