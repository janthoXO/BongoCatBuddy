import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { Menu } from "lucide-react";
import { useItems, artUrl, CHEST_TOKEN, EMOTE_CHEST_TOKEN, iconUrl, QUALITY_COLORS, type Item } from "@/lib/items";
import { MAX_WHEEL_EMOTES, usePrefs } from "@/lib/prefs";
import Chest from "./Chest";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import catLeft from "@/assets/placeholder/catLeft.svg";
import catLeftPunch from "@/assets/placeholder/catLeftPunch.svg";
import catRight from "@/assets/placeholder/catRight.svg";
import catRightPunch from "@/assets/placeholder/catRightPunch.svg";
import bongoLeft from "@/assets/placeholder/bongoLeft.svg";
import bongoLeftPunch from "@/assets/placeholder/bongoLeftPunch.svg";
import bongoRight from "@/assets/placeholder/bongoRight.svg";
import bongoRightPunch from "@/assets/placeholder/bongoRightPunch.svg";

const UNIT = 1.25; // px per unit at catScale 1
const HIT_MS = 100;

// Cat box in units: origin (the layer coordinate 0,0) sits at (OX, OY) from the box's top-left.
const BOX_W = 154;
const BOX_H = 204;
const OX = 80;
const OY = 109;
// Fixed px (not scaled) around the cat box.
const SIDE = 56; // chest column on each side
const WHEEL_R = 80;
const WHEEL_H = WHEEL_R + 14;
const POPUP_H = 48;
const TOP = POPUP_H + WHEEL_H;
const BOTTOM = 64; // score + notice
const WHEEL_W = 2 * WHEEL_R + 28;

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

const placeholders = {
  catLeft, catLeftPunch, catRight, catRightPunch,
  bongoLeft, bongoLeftPunch, bongoRight, bongoRightPunch,
};
type Name = keyof typeof placeholders;
type Art = Record<Name, string>;

const part = (n: Name) => n.replace(/^(cat|bongo)/, "");

// Layers in draw order (first = back); `show` says when it is visible.
const layers = (l: boolean, r: boolean) => [
  { n: "bongoLeftPunch", x: -16, y: -31, show: l },
  { n: "catLeft", x: -6, y: 10, show: !l },
  { n: "catLeftPunch", x: -6, y: 10, show: l },
  { n: "bongoLeft", x: -16, y: -31, show: !l },
  { n: "bongoRight", x: -16, y: -31, show: !r },
  { n: "bongoRightPunch", x: -16, y: -31, show: r },
  { n: "hat", x: 10, y: 45, show: true },
  { n: "catRight", x: -6, y: 10, show: !r },
  { n: "catRightPunch", x: -6, y: 10, show: r },
] as const;

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
  const [art, setArt] = useState<Art>(placeholders);
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const [bad, setBad] = useState<Set<string>>(new Set());
  const [hat, setHat] = useState(true);
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
  const bongos = owned(prefs.equipped.bongos);
  const hatItem = owned(prefs.equipped.hat);
  const hatSrc = hatItem ? artUrl(hatItem) : undefined;
  useEffect(() => setHat(true), [hatSrc]);

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
    invoke<string | null>("get_art")
      .then((dir) => {
        if (dir)
          setArt(
            Object.fromEntries(
              Object.keys(placeholders).map((n) => [n, convertFileSrc(`${dir}/${n}.png`)]),
            ) as Art,
          );
      })
      .catch(() => {});
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

  // Remote art for equipped cosmetics, falling back to the base art per layer on load errors.
  const srcOf = (n: Name) => {
    const it = n.startsWith("cat") ? skin : bongos;
    const url = it && artUrl(it, part(n));
    return url && !bad.has(url) ? url : art[n];
  };
  const markBad = (n: Name) => {
    const it = n.startsWith("cat") ? skin : bongos;
    if (it) setBad((s) => new Set(s).add(artUrl(it, part(n))));
  };

  const onWon = (id: number) => {
    setQueue((q) => [...q, { k: ++seq.current, id }]);
    const it = catalog?.get(id);
    if (prefs.autoEquipDrops && (it?.slot === "hat" || it?.slot === "skin" || it?.slot === "bongos"))
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
  const chestTop = TOP + 140 * L.u - 24;
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
        .bob { animation: bob 2s ease-in-out infinite; }
        .emote-float { animation: emote-float 1.5s ease-out forwards; }
        .chest-shake { animation: chest-shake 0.4s; }
        .chest-pop { animation: chest-pop 0.5s; }
        .chest-float { animation: chest-float 1s ease-out forwards; }
      `}</style>

      {won !== undefined && head && (
        <div
          className="absolute left-1/2 top-1 flex -translate-x-1/2 items-center gap-2 rounded-lg border-2 bg-background/90 px-2 py-1"
          style={{
            borderColor: won?.quality ? QUALITY_COLORS[won.quality] : undefined,
            height: POPUP_H - 4,
            maxWidth: L.w - 8,
          }}
        >
          {won ? <PopupIcon item={won} /> : null}
          <div className="min-w-0 leading-tight">
            <p className="text-[10px] text-muted-foreground">New item!</p>
            <p className="truncate text-xs font-semibold" style={{ color: won?.color }}>
              {won?.name ?? `#${head.id}`}
            </p>
          </div>
        </div>
      )}

      <div
        className="pointer-events-none absolute left-0"
        style={{ top: TOP - WHEEL_H, width: L.w, height: WHEEL_H + L.boxH }}
        onMouseEnter={() => setWheel(true)}
        onMouseLeave={() => setWheel(false)}
      >
        {wheel && wheelItems.length > 0 && (
          <div
            className="pointer-events-auto absolute"
            style={{ left: (L.w - WHEEL_W) / 2, top: 0, width: WHEEL_W, height: WHEEL_H }}
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
                  className="absolute flex size-7 items-center justify-center rounded-full border bg-background/90"
                  style={{
                    left: WHEEL_W / 2 - WHEEL_R * Math.cos(th) - 14,
                    top: WHEEL_H - WHEEL_R * Math.sin(th) - 14,
                    borderColor: it.quality ? QUALITY_COLORS[it.quality] : undefined,
                  }}
                >
                  <img src={iconUrl(it)} draggable={false} className="size-5 object-contain" />
                  {it.slot === "consumable" && (
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-background px-1 text-[9px] leading-tight tabular-nums">
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
          style={{ left: boxLeft, top: WHEEL_H, width: L.boxW, height: L.boxH }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu();
          }}
        >
          <div
            {...(prefs.lockPosition ? {} : { "data-tauri-drag-region": true })}
            className="relative size-full"
            style={{ transform: prefs.flip ? "scaleX(-1)" : undefined }}
          >
            {layers(left, right).map((l) => {
              const isHat = l.n === "hat";
              if (isHat && (!hatSrc || !hat)) return null;
              const src = isHat ? hatSrc : srcOf(l.n);
              return (
                <img
                  key={l.n}
                  src={src}
                  onError={() => (isHat ? setHat(false) : markBad(l.n))}
                  draggable={false}
                  className={`pointer-events-none absolute ${l.show ? "" : "invisible"}`}
                  style={{
                    left: (OX + l.x - 64) * L.u,
                    top: (OY - l.y - 64) * L.u,
                    width: 128 * L.u,
                    height: 128 * L.u,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <Chest
        kind="cosmetic"
        tokens={catalog ? (catalog.get(CHEST_TOKEN)?.qty ?? 0) : null}
        score={score?.current ?? null}
        prefs={prefs}
        onWon={onWon}
        style={{ left: 4, top: chestTop }}
      />
      {prefs.showEmoteChest && (
        <Chest
          kind="emote"
          tokens={catalog ? (catalog.get(EMOTE_CHEST_TOKEN)?.qty ?? 0) : null}
          score={score?.current ?? null}
          prefs={prefs}
          onWon={onWon}
          style={{ right: 4, top: chestTop }}
        />
      )}

      {particles.map((p) => (
        <EmoteParticle key={p.k} item={p.item} left={L.w / 2 - 32} top={TOP - 32} />
      ))}

      <div
        className="absolute left-0 flex flex-col items-center gap-1"
        style={{ top: TOP + L.boxH + 2, width: L.w }}
      >
        <span
          title={score ? `Lifetime: ${score.lifetime}` : undefined}
          className={`relative rounded-full bg-background/80 px-2 font-medium tabular-nums text-foreground ${
            prefs.hideCounter ? "opacity-0 group-hover:opacity-100" : ""
          }`}
        >
          {score ? score.current.toLocaleString("en-US").replace(/,/g, " ") : "…"}
          <button
            type="button"
            title="Menu"
            onClick={openMenu}
            className="absolute left-full top-1/2 ml-1 -translate-y-1/2 rounded-full bg-background/80 p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100"
          >
            <Menu className="size-3.5" />
          </button>
        </span>
        {notice && <p className="px-2 text-center text-xs text-muted-foreground">{notice}</p>}
      </div>
    </main>
  );
}

function PopupIcon({ item }: { item: Item }) {
  const [ok, setOk] = useState(true);
  return ok ? (
    <img src={iconUrl(item)} onError={() => setOk(false)} draggable={false} className="size-8 object-contain" />
  ) : (
    <span className="flex size-8 items-center justify-center rounded bg-muted text-xs font-bold">
      {item.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
    </span>
  );
}
