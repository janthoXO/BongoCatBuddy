import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { availableMonitors, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Heart, Menu, MessageCircle, PawPrint } from "lucide-react";
import { useItems, CHEST_TOKEN, EMOTE_CHEST_TOKEN, iconUrl, QUALITY_COLORS, type Item } from "@/lib/items";
import { MAX_WHEEL_EMOTES, usePrefs } from "@/lib/prefs";
import Chest from "./Chest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CatFigure, FIGURE_H, FIGURE_W } from "@/components/CatFigure";
import { EmoteParticle } from "@/components/EmoteParticle";
import { CH, lobbySend, MAX_SPEECH, onLobbyMsg, remoteLayout, useLobby } from "@/lib/lobby";
import { RemoteCat } from "./RemoteCat";
import { maskOf, onMask } from "@/lib/mask";

const UNIT = 1.25; // px per unit at catScale 1
const HIT_MS = 100;

// Cat box in units = the figure (see CatFigure).
const BOX_W = FIGURE_W;
const BOX_H = FIGURE_H;
// Fixed px (not scaled) around the cat box.
const SIDE = 30; // each side margin: room for the score row with its chests and buttons
const TOP = 0; // nothing reserved above the box: the popup and emote bar overlap its empty hat area
const ART_END = 14; // units: the cat art ends this far above the figure box; the score row tucks up into it
const WHEEL_W = 8 * 24 + 7 * 2 + 4; // widest emote bar: 8 emotes
const BOTTOM = 52; // score row + notice / chat input

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
type Pos = [number, number];
type Rect = { x: number; y: number; w: number; h: number };

const PAD = 24; // room around the cats for floating emotes and hearts

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

const SNAP = 8; // px: a dragged cat this close to a screen edge or another cat's line jumps onto it

/**
 * PowerPoint-style magnet for a `w x h` box at `p`, per axis: the box onto a screen edge or the
 * screen center, or its cat (`fig`, inside the box) edge/center onto another cat's, nearest within SNAP.
 */
function snap(p: Pos, w: number, h: number, fig: Rect, cats: Rect[], S: Rect & { top: number }): Pos {
  const lines = (a: number, len: number) => [a, a + len / 2, a + len];
  const axis = (v: number, screen: number[], cat: number[], at: number, len: number) => {
    const c = [...screen, ...cat.flatMap((l) => lines(at, len).map((o) => l - o))]
      .reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), Infinity);
    return Math.abs(c - v) <= SNAP ? c : v;
  };
  return [
    axis(p[0], [0, (S.w - w) / 2, S.w - w], cats.flatMap((r) => lines(r.x, r.w)), fig.x, fig.w),
    axis(p[1], [S.top, (S.top + S.h - h) / 2, S.h - h], cats.flatMap((r) => lines(r.y, r.h)), fig.y, fig.h),
  ];
}

const GAP = 6; // px between what neighbouring cats show

/**
 * Spots (box positions) for other cats lined up from ours, `GAP` apart by what each cat really
 * shows: `occ[i]` (and `meOcc`) is that part inside its box (sprites and bars, see `occupied`). A
 * row runs along x with feet level with ours (`meFeet`, and `feet` px down inside a box), a column
 * along y with box centers aligned. Each line first grows toward the side of the screen with more
 * room, then toward the other side; a full line wraps to the next one, also toward more room, the
 * widest/tallest cat apart, whose first cat sits level with ours.
 */
function lineSpots(column: boolean, me: Rect, meOcc: Rect, meFeet: number, occ: Rect[], w: number, feet: number, S: Rect & { top: number }) {
  const mine = { x: me.x + meOcc.x, y: me.y + meOcc.y, w: meOcc.w, h: meOcc.h };
  const dx = mine.x + mine.w / 2 < S.w / 2 ? 1 : -1;
  const dy = mine.y + mine.h / 2 < (S.top + S.h) / 2 ? 1 : -1;
  const d = column ? dy : dx;
  const line = Math.max(...occ.map((o) => (column ? o.w : o.h))) + GAP;
  const along = (r: Rect) => (column ? [r.y, r.h] : [r.x, r.w]);
  const [lo, hi] = column ? [S.top, S.h] : [0, S.w];
  const [ma, ml] = along(mine);
  const spots: Pos[] = [];
  let k = 0; // line
  let span: Pos | null = [ma, ma + ml]; // what the line covers so far, along it; null = empty
  let dir = d; // side it grows to now
  for (const o of occ) {
    const [a, len] = along(o);
    for (;;) {
      const at: number = !span ? ma + (ml - len) / 2 - a : dir > 0 ? span[1] + GAP - a : span[0] - GAP - a - len;
      // off screen along the line: other side, then next line; a line always gets one cat so this
      // ends (too small a screen: overlap). Across it the spots are clamped onto the screen later.
      if (span && (at + a < lo || at + a + len > hi)) {
        if (dir === d) dir = -d;
        else [k, span, dir] = [k + 1, null, d];
        continue;
      }
      const across = column ? me.x + (me.w - w) / 2 + dx * k * line : meFeet - feet + dy * k * line;
      spots.push(column ? [across, at] : [at, across]);
      span = span ? [Math.min(span[0], at + a), Math.max(span[1], at + a + len)] : [at + a, at + a + len];
      break;
    }
  }
  return spots;
}

/** `el`'s layout box inside `box` (an ancestor), ignoring CSS transforms like bobbing or squish. */
function offsetIn(el: HTMLElement, box: HTMLElement): Rect {
  let [x, y] = [0, 0];
  for (let e: HTMLElement | null = el; e && e !== box; e = e.offsetParent as HTMLElement | null) {
    x += e.offsetLeft;
    y += e.offsetTop;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/**
 * What a cat box really shows, inside it: its sprites' opaque cells (each whole sprite until its
 * mask is in) and its bars (`data-solid`, buttons). Not the emote bar, which only shows on
 * hover; the layout must not move then.
 */
function occupied(box: HTMLElement): Rect | null {
  const parts: Rect[] = [];
  for (const fig of box.querySelectorAll<HTMLElement>("[data-figure]")) {
    const f = offsetIn(fig, box);
    const flip = fig.hasAttribute("data-flip");
    for (const img of fig.querySelectorAll("img")) {
      const r = offsetIn(img, fig);
      for (const [x, y, w, h] of maskOf(img.src) ?? [[0, 0, 1, 1]]) {
        const px = r.x + x * r.w;
        parts.push({ x: f.x + (flip ? f.w - px - w * r.w : px), y: f.y + r.y + y * r.h, w: w * r.w, h: h * r.h });
      }
    }
  }
  for (const el of box.querySelectorAll<HTMLElement>("[data-solid], button:not(.wheel-pop *), input")) {
    const r = offsetIn(el, box);
    if (r.w && r.h) parts.push(r);
  }
  return parts.length ? parts.reduce(union) : null;
}

type Particle = { k: number; item: Item };
type Won = { k: number; id: number };

export default function Overlay() {
  const [prefs, update] = usePrefs();
  const { catalog } = useItems();
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  // What the mouse is over: "me", a steam id, or null. Comes from Rust, which also turns
  // click-through off over the boxes marked `data-hit`.
  const [hover, setHover] = useState<string | null>(null);
  // The screen the cats live on (logical px, `top` = below the menu bar) and where the overlay
  // window really is on it. Cat positions are screen px, drawn relative to the window, which
  // only covers the cats (a full-screen transparent window costs ~150 MB of graphics memory).
  const [screen, setScreen] = useState<Rect & { top: number } | null>(null);
  const [win, setWin] = useState<Rect | null>(null);
  // Window rect when a native window drag started (moving the whole window, see below).
  const [nativeFrom, setNativeFrom] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  // what each cat box really shows, by id (see `occupied`)
  const [occ, setOcc] = useState<Record<string, Rect>>({});
  const dragged = useRef(false);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [queue, setQueue] = useState<Won[]>([]);
  const lobby = useLobby();
  const [chestReady, setChestReady] = useState({ cosmetic: false, emote: false });
  const [gift, setGift] = useState({ cosmetic: 0, emote: 0 });
  const [hearts, setHearts] = useState<number[]>([]);
  const [squish, setSquish] = useState(false);
  const [typing, setTyping] = useState(false);
  const [speech, setSpeech] = useState<{ k: number; text: string } | null>(null);
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
    (async () => {
      const all = await availableMonitors();
      const m = all.find((x) => x.name === prefs.monitor) ?? (await primaryMonitor()) ?? all[0];
      if (!m) return;
      const sf = m.scaleFactor;
      setScreen({
        x: m.position.x / sf,
        y: m.position.y / sf,
        w: m.size.width / sf,
        h: m.size.height / sf,
        top: (m.workArea.position.y - m.position.y) / sf,
      });
    })().catch(() => {});
  }, [prefs.monitor]);
  useEffect(() => {
    if (!screen) return;
    const w = getCurrentWindow();
    const read = async () => {
      const sf = await w.scaleFactor();
      const p = (await w.outerPosition()).toLogical(sf);
      const s = (await w.innerSize()).toLogical(sf);
      setWin({ x: p.x - screen.x, y: p.y - screen.y, w: s.width, h: s.height });
    };
    void read();
    const un = [w.onMoved(read), w.onResized(read)];
    return () => un.forEach((u) => void u.then((f) => f()));
  }, [screen]);

  const S = screen ?? { x: 0, y: 0, w: innerWidth, h: innerHeight, top: 0 };
  const R = remoteLayout(prefs.catScale);
  const clamp = ([x, y]: Pos, w: number, h: number): Pos => [
    Math.max(0, Math.min(x, S.w - w)),
    Math.max(S.top, Math.min(y, S.h - h)),
  ];
  const at = (id: string, [x, y]: Pos): Pos => (drag?.id === id ? [x + drag.dx, y + drag.dy] : [x, y]);
  const myBase = clamp(prefs.myPos ?? [S.w - L.w - 40, S.h - L.h - 80], L.w, L.h);
  // during a native drag our cat rides along with the window
  const shift: Pos = nativeFrom && win ? [win.x - nativeFrom.x, win.y - nativeFrom.y] : [0, 0];
  const me = at("me", [myBase[0] + shift[0], myBase[1] + shift[1]]);
  const others = lobby
    ? lobby.members.filter((m) => m.id !== lobby.me && !prefs.hiddenPlayers.includes(m.id)).slice(0, prefs.maxCats)
    : [];
  // The cat art ends 14 units above the figure's bottom (see remoteLayout). What each box really
  // shows is measured after rendering (`occ`); until then the whole box counts.
  const spots = lineSpots(
    prefs.catLayout === "column", { x: me[0], y: me[1], w: L.w, h: L.h }, occ.me ?? { x: 0, y: 0, w: L.w, h: L.h },
    me[1] + TOP + L.boxH - 14 * L.u, others.map((m) => occ[m.id] ?? { x: 0, y: 0, w: R.w, h: R.h }), R.w, R.top + R.figH - 14 * R.u, S,
  );
  const free = prefs.catLayout === "free";
  const otherBase = (id: string, i: number): Pos => clamp(free ? (prefs.catPos[id] ?? spots[i]) : spots[i], R.w, R.h);
  const placed = others.map((m, i) => {
    const base = otherBase(m.id, i);
    return { m, base, at: at(m.id, base) };
  });
  // where the cat art sits inside each box, and every cat on screen (snap targets)
  const myFig: Rect = { x: (L.w - L.boxW) / 2, y: TOP, w: L.boxW, h: L.boxH };
  const remoteFig: Rect = { x: (R.w - R.figW) / 2, y: R.top, w: R.figW, h: R.figH };
  const figs = [
    { id: "me", ...myFig, x: me[0] + myFig.x, y: me[1] + myFig.y },
    ...placed.map((o) => ({ id: o.m.id, ...remoteFig, x: o.at[0] + remoteFig.x, y: o.at[1] + remoteFig.y })),
  ];

  // The window covers just the cats. Moving its left/top edge makes the cats jump for a frame
  // or two (the window moves before WebKit repaints), so drags avoid that: our cat alone drags
  // the whole window natively; with other cats the window first stretches over the screen once
  // and the drag happens inside it, so a row or column can re-flow live (a native drag keeps the
  // window's size and would cut off cats that move to the other side).
  const tight = grow(
    placed.reduce((r, o) => union(r, { x: o.at[0], y: o.at[1], w: R.w, h: R.h }), { x: me[0], y: me[1], w: L.w, h: L.h }),
    PAD,
  );
  const fit = (r: Rect): Rect => {
    const x = Math.max(0, r.x);
    const y = Math.max(S.top, r.y);
    return { x, y, w: Math.min(S.w, r.x + r.w) - x, h: Math.min(S.h, r.y + r.h) - y };
  };
  const want = fit(drag ? { x: 0, y: 0, w: S.w, h: S.h } : tight);
  const wantKey = [want.x, want.y, want.w, want.h].map(Math.round).join();
  useEffect(() => {
    if (!screen || nativeFrom) return;
    const w = getCurrentWindow();
    void w
      .setPosition(new LogicalPosition(screen.x + want.x, screen.y + want.y))
      .then(() => w.setSize(new LogicalSize(want.w, want.h)))
      .catch(() => {});
  }, [wantKey, screen, nativeFrom]);
  const [ox, oy] = win ? [win.x, win.y] : [want.x, want.y];

  const wholeWindow = placed.length === 0;
  const startWindowDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || !win) return;
    setNativeFrom(win);
    getCurrentWindow().startDragging().catch(() => setNativeFrom(null));
  };
  // Clicking our cat (no drag) shows or hides the score bar.
  const toggleBar = () => update({ hideCounter: !prefs.hideCounter });
  // Rust reports the release (the page never sees it during a native drag, nor the click): save
  // where we are, snapped to the screen edges unless Alt is held. The other cats follow ours, so
  // no cat lines. Not moved: it was a click.
  const endNative = useRef((_alt: boolean) => {});
  endNative.current = (alt) => {
    if (!nativeFrom) return;
    if (shift[0] || shift[1]) update({ myPos: clamp(alt ? me : snap(me, L.w, L.h, myFig, [], S), L.w, L.h) });
    else toggleBar();
    setNativeFrom(null);
  };
  useEffect(() => {
    const un = listen<boolean>("mouse-up", (e) => endNative.current(e.payload));
    return () => void un.then((f) => f());
  }, []);

  /**
   * Drags a box with the pointer, snapping to the screen and the other cats unless Alt is held;
   * under 4px of movement it stays a click (see `dragged`).
   */
  const startDrag = (id: string, from: Pos, w: number, h: number, fig: Rect) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // screen coordinates: the window may move under the pointer while it grows
    const [sx, sy] = [e.screenX, e.screenY];
    // in a row or column the other cats follow ours: only the screen to snap to
    const cats = free ? figs.filter((f) => f.id !== id) : [];
    // free layout: every cat stays where it is, also the ones still in their first spot (those
    // follow ours), so they are saved once the drag really starts
    const pinned = { ...prefs.catPos, ...Object.fromEntries(placed.map((o) => [o.m.id, o.base])) };
    let last: { dx: number; dy: number } | null = null;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      const [dx, dy] = [ev.screenX - sx, ev.screenY - sy];
      if (!last && Math.hypot(dx, dy) < 4) return;
      if (!last && free) update({ catPos: pinned });
      const p: Pos = [from[0] + dx, from[1] + dy];
      const [x, y] = ev.altKey ? p : snap(p, w, h, fig, cats, S);
      last = { dx: x - from[0], dy: y - from[1] };
      dragged.current = true;
      setDrag({ id, ...last });
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      setDrag(null);
      if (!last) return;
      const p = clamp([from[0] + last.dx, from[1] + last.dy], w, h);
      update(id === "me" ? { myPos: p } : { catPos: { ...pinned, [id]: p } });
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };

  // Tell Rust where the boxes are after every render that moved one. Rust hovers the first rect
  // under the cursor, so ours goes first: other cats' empty bubble room may overlap it (column).
  // Clicks only land on what is solid: each sprite's opaque cells (its whole square until its
  // mask is in) and the buttons; the rest of a box only hovers, clicks there go through.
  const lastHit = useRef("");
  const [, setMasks] = useState(0);
  useEffect(() => onMask(() => setMasks((n) => n + 1)), []);
  useLayoutEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-hit]")];
    const rects = [...els.filter((el) => el.dataset.hit === "me"), ...els.filter((el) => el.dataset.hit !== "me")].map((el) => {
      const r = el.getBoundingClientRect();
      return [el.dataset.hit, r.x, r.y, r.width, r.height];
    });
    const solid = [...document.querySelectorAll<HTMLElement>("[data-hit] [data-figure] img, [data-hit] [data-solid], [data-hit] button, [data-hit] input")]
      .flatMap((el) => {
        const r = el.getBoundingClientRect();
        const m = el instanceof HTMLImageElement ? maskOf(el.src) : null;
        if (!m) return [[r.x, r.y, r.width, r.height]];
        const flip = !!el.closest("[data-flip]");
        return m.map(([x, y, w, h]) => [r.x + (flip ? 1 - x - w : x) * r.width, r.y + y * r.height, w * r.width, h * r.height]);
      })
      .map((r) => r.map(Math.round));
    const shown = Object.fromEntries(els.flatMap((el) => {
      const r = occupied(el);
      return r ? [[el.dataset.hit!, r]] : [];
    }));
    if (JSON.stringify(shown) !== JSON.stringify(occ)) setOcc(shown);
    const json = JSON.stringify([rects, solid, !!drag]);
    if (json === lastHit.current) return;
    lastHit.current = json;
    invoke("set_hit_rects", { rects, solid, hold: !!drag }).catch(() => {});
  });

  // Multiplayer: what others see of us, and what they send us.
  useEffect(() => {
    if (!catalog) return;
    const data = {
      hat: String(hatItem?.id ?? -1),
      skin: String(skin?.id ?? -1),
      chest_ready: String(chestReady.cosmetic),
      emote_chest_ready: String(chestReady.emote),
    };
    invoke("lobby_set_me", { data }).catch(() => {});
  }, [catalog, hatItem?.id, skin?.id, chestReady]);
  useEffect(() => {
    if (prefs.joinLastLobby && prefs.lastLobby)
      invoke("lobby_join_id", { id: prefs.lastLobby }).catch(() => update({ lastLobby: undefined }));
  }, []);
  useEffect(() => {
    if (lobby && lobby.id !== prefs.lastLobby) update({ lastLobby: lobby.id });
  }, [lobby?.id]);
  const live = useRef({ me: "", receivePats: true });
  live.current = { me: lobby?.me ?? "", receivePats: prefs.receivePats };
  useEffect(() => {
    const un = onLobbyMsg((m) => {
      const { me, receivePats } = live.current;
      if (m.channel === CH.pat && m.message === me && receivePats) {
        setSquish(true);
        setTimeout(() => setSquish(false), 700);
        const k = ++seq.current;
        setHearts((h) => [...h, k]);
        setTimeout(() => setHearts((h) => h.filter((x) => x !== k)), 1500);
      } else if (m.channel === CH.openChest) {
        const [target, type] = m.message.split(":");
        if (target === me) {
          const kind = type === "1" ? "emote" : "cosmetic";
          setGift((g) => ({ ...g, [kind]: g[kind] + 1 }));
        }
      }
    });
    return () => void un.then((f) => f());
  }, []);
  useEffect(() => {
    if (!speech) return;
    const id = setTimeout(() => setSpeech(null), 5000);
    return () => clearTimeout(id);
  }, [speech?.k]);
  const say = (text: string) => {
    setTyping(false);
    text = text.trim().slice(0, MAX_SPEECH);
    if (!text) return;
    setSpeech({ k: ++seq.current, text });
    void lobbySend(CH.speech, text);
  };

  useEffect(() => {
    invoke("set_ignore_mouse", { ignore: prefs.ignoreMouse }).catch(() => {});
  }, [prefs.ignoreMouse]);

  // Random outfit, like the game's hat randomizer: every N minutes another owned, not hidden
  // hat and skin (only favorites if set). Reads the latest prefs/catalog so they don't restart the timer.
  const outfit = useRef({ prefs, catalog });
  outfit.current = { prefs, catalog };
  useEffect(() => {
    if (!prefs.randomOutfit) return;
    const t = setInterval(() => {
      const { prefs: p, catalog: c } = outfit.current;
      if (!c) return;
      const equipped = { ...p.equipped };
      for (const slot of ["hat", "skin"] as const) {
        const pool = [...c.values()].filter(
          (i) => i.slot === slot && i.qty > 0 && i.id !== p.equipped[slot] && !p.hidden.includes(i.id) && (!p.randomFavorites || p.favorites.includes(i.id)),
        );
        if (pool.length) equipped[slot] = pool[Math.floor(Math.random() * pool.length)].id;
      }
      update({ equipped });
    }, prefs.randomOutfit * 60_000);
    return () => clearInterval(t);
  }, [prefs.randomOutfit]);

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
      listen<string | null>("hover", (e) => setHover(e.payload)),
      listen<string>("lobby-error", (e) => {
        setFlash(e.payload);
        setTimeout(() => setFlash(null), 4000);
      }),
    ];
    return () => unlisten.forEach((p) => p.then((f) => f()));
  }, []);


  const onWon = (id: number) => {
    setQueue((q) => [...q, { k: ++seq.current, id }]);
    void lobbySend(CH.item, String(id));
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

  // no emotes picked in the inventory: no emote bar
  const wheelItems = prefs.emotes
    .map((id) => owned(id))
    .filter((i): i is Item => !!i)
    .slice(0, MAX_WHEEL_EMOTES);
  const useEmote = (item: Item) => {
    const k = ++seq.current;
    setParticles((p) => [...p, { k, item }]);
    setTimeout(() => setParticles((p) => p.filter((x) => x.k !== k)), 1500);
    void lobbySend(CH.emote, String(item.id));
    invoke("use_emote", { def: item.id }).catch((e) => {
      setFlash(String(e));
      setTimeout(() => setFlash(null), 3000);
    });
  };

  const boxLeft = (L.w - L.boxW) / 2;
  const chestsRight = me[0] + L.w / 2 < S.w / 2;
  // Chests flank the score pill under the cat, so they never cover the art.
  const headY = TOP + 95 * L.u; // around the cat's head: emotes and hearts float up from here
  const rowTop = TOP + L.boxH - ART_END * L.u + 2;
  const notice = flash ?? error;
  const openMenu = () => void invoke("open_menu").catch(() => {});
  const hovered = hover === "me" || drag?.id === "me";
  const wheel = hovered && !drag;
  const showOnHover = hovered ? "" : "opacity-0";

  return (
    <main className="relative h-svh w-svw overflow-hidden">
      {placed.map(({ m, base, at: [x, y] }) => (
        <RemoteCat
          key={m.id}
          member={m}
          catalog={catalog}
          prefs={prefs}
          hovered={hover === m.id}
          chestsRight={x + R.w / 2 < S.w / 2}
          x={x - ox}
          y={y - oy}
          drag={free ? { onPointerDown: startDrag(m.id, base, R.w, R.h, remoteFig), wasDragged: () => dragged.current } : undefined}
        />
      ))}
      <div data-hit="me" className="absolute" style={{ left: me[0] - ox, top: me[1] - oy, width: L.w, height: L.h }}>

        {won !== undefined && head && (
          <div
            key={head.k}
            className="popup pill pointer-events-none absolute left-1/2 top-1 z-20 flex items-center gap-2 overflow-hidden rounded-xl py-1 pl-3 pr-3"
            style={{ maxWidth: L.w - 8 }}
          >
            <span
              className="absolute inset-y-0 left-0 w-1.5"
              style={{ background: won?.quality ? QUALITY_COLORS[won.quality] : "var(--border)" }}
            />
            {won ? <PopupIcon item={won} /> : null}
            <div className="min-w-0 leading-tight">
              <p className="text-[10px] text-muted-foreground">New item</p>
              <p className="flex items-center gap-1 text-xs font-semibold text-foreground">
                <span className="truncate">{won?.name ?? `#${head.id}`}</span>
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
        >
          {wheel && wheelItems.length > 0 && (
            // just above the visible art (hat or ears, see `occupied`), inside the window's padding
            <div className="pointer-events-none absolute left-0 z-10 flex w-full justify-center" style={{ top: Math.max((occ.me?.y ?? TOP) - 32, 2 - PAD) }}>
              <div className="wheel-pop pill flex gap-0.5 p-0.5">
                {wheelItems.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    title={it.name}
                    onClick={(e) => {
                      e.stopPropagation();
                      useEmote(it);
                    }}
                    className="pointer-events-auto relative flex size-6 items-center justify-center rounded-full hover:bg-accent"
                  >
                    <img src={iconUrl(it)} draggable={false} className="size-4 object-contain" />
                    {it.slot === "consumable" && (
                      <span className="pill absolute -right-1 -bottom-1 px-1 text-[9px] leading-tight tabular-nums">{it.qty}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div
            className="pointer-events-auto absolute"
            style={{ left: boxLeft, top: TOP, width: L.boxW, height: L.boxH }}
            onPointerDown={prefs.lockPosition ? undefined : wholeWindow ? startWindowDrag : startDrag("me", myBase, L.w, L.h, myFig)}
            onClick={!prefs.lockPosition && wholeWindow ? undefined : () => !dragged.current && toggleBar()}
            onContextMenu={(e) => {
              e.preventDefault();
              openMenu();
            }}
          >
            <CatFigure
              className={squish ? "squish" : undefined}
              unit={L.u}
              skin={skin}
              hat={hatItem}
              left={left}
              right={right}
              flip={prefs.flip}
            />
          </div>
        </div>

        {speech && (
          <p
            key={speech.k}
            className="pill pointer-events-none absolute left-1/2 top-1 z-20 line-clamp-2 -translate-x-1/2 break-words rounded-xl px-2 py-0.5 text-center text-xs"
            style={{ maxWidth: L.w - 8 }}
          >
            {speech.text}
          </p>
        )}
        {hearts.map((k, i) => (
          <Heart
            key={k}
            className="emote-float pointer-events-none absolute z-30 size-6 fill-primary text-primary"
            style={{ left: L.w / 2 - 12 + ((i % 3) - 1) * 18, top: headY - 40 }}
          />
        ))}

        {particles.map((p) => (
          <EmoteParticle key={p.k} item={p.item} left={L.w / 2 - 32} top={headY - 32} />
        ))}

        <div
          className="absolute left-0 flex flex-col items-center gap-1"
          style={{ top: rowTop, width: L.w }}
        >
          {/* score centered; ready chests hang off it toward more screen room, the hover buttons
              off the other end, so neither shifts it (the buttons stay mounted: the cat layout
              measures them, see `occupied`) */}
          <div className="relative flex h-6 items-center">
            {!prefs.hideCounter && (
              <span
                data-solid
                title={score ? `Lifetime: ${score.lifetime}` : undefined}
                className="pill flex items-center gap-1 px-2 text-sm font-medium leading-6 tabular-nums"
              >
                <PawPrint className="size-3.5 text-muted-foreground" />
                {score ? score.current.toLocaleString("en-US").replace(/,/g, " ") : "…"}
              </span>
            )}
            <div className={`absolute top-0 flex gap-1 ${chestsRight ? "left-full ml-1" : "right-full mr-1"}`}>
              <Chest
                kind="cosmetic"
                onReady={(r) => setChestReady((c) => (c.cosmetic === r ? c : { ...c, cosmetic: r }))}
                gift={gift.cosmetic}
                tokens={catalog ? (catalog.get(CHEST_TOKEN)?.qty ?? 0) : null}
                score={score?.current ?? null}
                onWon={onWon}
              />
              <Chest
                kind="emote"
                onReady={(r) => setChestReady((c) => (c.emote === r ? c : { ...c, emote: r }))}
                gift={gift.emote}
                tokens={catalog ? (catalog.get(EMOTE_CHEST_TOKEN)?.qty ?? 0) : null}
                score={score?.current ?? null}
                onWon={onWon}
              />
            </div>
            <div className={`absolute top-0 flex gap-1 ${chestsRight ? "right-full mr-1" : "left-full ml-1"}`}>
              {lobby && (
                <button
                  type="button"
                  title="Say something"
                  onClick={() => setTyping(true)}
                  className={`pill flex size-6 items-center justify-center transition-opacity ${showOnHover}`}
                >
                  <MessageCircle className="size-3" />
                </button>
              )}
              <button
                type="button"
                title="Menu"
                onClick={openMenu}
                className={`pill flex size-6 items-center justify-center transition-opacity ${showOnHover}`}
              >
                <Menu className="size-3" />
              </button>
            </div>
          </div>
          {typing && (
            <input
              autoFocus
              maxLength={MAX_SPEECH}
              placeholder="Say something…"
              onKeyDown={(e) => {
                if (e.key === "Enter") say(e.currentTarget.value);
                if (e.key === "Escape") setTyping(false);
              }}
              onBlur={(e) => say(e.currentTarget.value)}
              className="pill px-2 text-xs leading-6 outline-none"
              style={{ width: L.w - 16 }}
            />
          )}
          {notice && (
            <p
              className="pill max-w-full truncate px-2 text-center text-[10px] leading-4 text-muted-foreground"
              style={{ maxWidth: L.w - 8 }}
            >
              {notice}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function PopupIcon({ item }: { item: Item }) {
  const [ok, setOk] = useState(true);
  return ok ? (
    <img src={iconUrl(item)} onError={() => setOk(false)} draggable={false} className="size-9 object-contain" />
  ) : (
    <span className="flex size-9 items-center justify-center rounded bg-muted text-xs font-medium">
      {item.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
    </span>
  );
}
