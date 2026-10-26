import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Gift, Heart, Smile } from "lucide-react";
import { iconUrl, QUALITY_COLORS, CHEST_PRICE, type Item } from "@/lib/items";
import type { Prefs } from "@/lib/prefs";
import { CH, MAX_SPEECH, lobbySend, onLobbyMsg, remoteLayout, type Member } from "@/lib/lobby";
import { CatFigure } from "@/components/CatFigure";
import { EmoteParticle } from "@/components/EmoteParticle";

const HIT_MS = 100;
type Kind = "cosmetic" | "emote";

export function RemoteCat({
  member,
  catalog,
  prefs,
  hovered,
  x,
  y,
  drag,
}: {
  member: Member;
  catalog: Map<number, Item> | null;
  prefs: Prefs;
  /** the mouse is over this cat's box (CSS :hover is unreliable in the click-through overlay) */
  hovered: boolean;
  /** box position in px inside the overlay */
  x: number;
  y: number;
  /** free layout: start dragging on pointer down; `wasDragged()` is true right after a drag so the click is not a pat */
  drag?: { onPointerDown: (e: React.PointerEvent) => void; wasDragged: () => boolean };
}) {
  const id = member.id;

  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const [particles, setParticles] = useState<{ k: number; item: Item }[]>([]);
  const [speech, setSpeech] = useState<{ k: number; text: string } | null>(null);
  const [queue, setQueue] = useState<{ k: number; id: number }[]>([]);
  const squishEl = useRef<HTMLDivElement>(null);
  const [hearts, setHearts] = useState<{ k: number; x: number }[]>([]);
  const [hidden, setHidden] = useState({ cosmetic: false, emote: false });
  const [fx, setFx] = useState<Kind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const wasLeft = useRef(false);
  const punching = useRef({ left: false, right: false });
  const seq = useRef(0);
  const live = useRef({ prefs, catalog });
  live.current = { prefs, catalog };

  const L = remoteLayout(prefs.catScale * prefs.remoteCatRatio);

  const burst = () => {
    const n = 1 + Math.floor(Math.random() * 3);
    const add = Array.from({ length: n }, () => ({ k: ++seq.current, x: Math.random() * 40 - 20 }));
    setHearts((h) => [...h, ...add]);
    setTimeout(() => setHearts((h) => h.filter((x) => !add.includes(x))), 1000);
  };
  const doSquish = () =>
    squishEl.current?.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.15, 0.85)", offset: 0.2 }, { transform: "scale(0.9, 1.1)", offset: 0.55 }, { transform: "scale(1)" }],
      { duration: 700, easing: "ease-out" },
    );

  useEffect(() => {
    const punch = (side: "left" | "right") => {
      if (punching.current[side]) return;
      punching.current[side] = true;
      (side === "left" ? setLeft : setRight)(true);
      setTimeout(() => {
        punching.current[side] = false;
        (side === "left" ? setLeft : setRight)(false);
      }, HIT_MS);
    };
    const un = onLobbyMsg((m) => {
      const { prefs, catalog } = live.current;
      if (m.channel === CH.pat) {
        if (m.message === id) doSquish();
        return;
      }
      if (m.from !== id) return;
      if (m.channel === CH.taps) {
        punch(wasLeft.current ? "right" : "left");
        wasLeft.current = !wasLeft.current;
      } else if (m.channel === CH.emote) {
        const item = catalog?.get(Number(m.message));
        if (!item) return;
        const k = ++seq.current;
        setParticles((p) => [...p, { k, item }]);
        setTimeout(() => setParticles((p) => p.filter((x) => x.k !== k)), 1500);
      } else if (m.channel === CH.speech) {
        if (prefs.muteChats) return;
        const k = ++seq.current;
        setSpeech({ k, text: m.message.slice(0, MAX_SPEECH) });
        setTimeout(() => setSpeech((s) => (s?.k === k ? null : s)), 5000);
      } else if (m.channel === CH.item) {
        if (!prefs.multiplayerPopups) return;
        setQueue((q) => [...q, { k: ++seq.current, id: Number(m.message) }]);
      }
    });
    return () => void un.then((f) => f());
  }, [id]);

  const head = queue[0];
  useEffect(() => {
    if (!head) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 4000);
    return () => clearTimeout(t);
  }, [head?.k]);

  // A chest hidden after a gift comes back once the member's flag went false.
  useEffect(() => {
    setHidden((h) => ({
      cosmetic: h.cosmetic && !!member?.chest_ready,
      emote: h.emote && !!member?.emote_chest_ready,
    }));
  }, [member?.chest_ready, member?.emote_chest_ready]);

  const item = (n: number | null) => (n === null ? undefined : catalog?.get(n));
  const won = head && (catalog?.get(head.id) ?? null);

  const gift = async (e: React.MouseEvent, kind: Kind) => {
    e.stopPropagation();
    try {
      await invoke("gift_chest", { target: id, kind });
      setHidden((h) => ({ ...h, [kind]: true }));
      setFx(kind);
      setTimeout(() => setFx(null), 1200);
      burst();
    } catch (er) {
      setErr(String(er));
      setTimeout(() => setErr(null), 3000);
    }
  };

  const chests: [Kind, boolean][] = [
    ["cosmetic", member.chest_ready],
    ["emote", member.emote_chest_ready],
  ];

  return (
    <div
      data-hit={member.id}
      // boxes may overlap (column layout): only the cat and its buttons take the pointer
      className="pointer-events-none absolute"
      style={{ left: x, top: y, width: L.w, height: L.h }}
      onContextMenu={(e) => {
        e.preventDefault();
        void invoke("open_menu").catch(() => {});
      }}
    >
      {speech && (
        <p
          key={speech.k}
          className="pointer-events-none absolute left-1/2 top-1 z-20 line-clamp-2 -translate-x-1/2 break-words rounded-xl border-2 border-outline bg-card px-2 py-0.5 text-center font-heading text-xs leading-tight text-foreground shadow-sticker-sm"
          style={{ maxWidth: L.w - 8 }}
        >
          {speech.text}
        </p>
      )}

      {head && won !== undefined && (
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
            <p className="truncate text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
              {member.name} got
            </p>
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
        className="pointer-events-auto absolute"
        style={{ left: (L.w - L.figW) / 2, top: L.top, width: L.figW, height: L.figH }}
        onPointerDown={drag?.onPointerDown}
        onClick={() => {
          if (drag?.wasDragged()) return;
          doSquish();
          burst();
          void lobbySend(CH.pat, id);
        }}
      >
        <div ref={squishEl} style={{ transformOrigin: "bottom" }}>
          <CatFigure
            unit={L.u}
            skin={item(member.skin)}
            hat={item(member.hat)}
            left={left}
            right={right}
          />
        </div>
      </div>

      {particles.map((p) => (
        <EmoteParticle key={p.k} item={p.item} left={L.w / 2 - 32} top={L.top - 20} />
      ))}

      {hearts.map((h) => (
        <Heart
          key={h.k}
          className="heart-float pointer-events-none absolute z-30 size-4 fill-primary text-primary"
          style={{ left: L.w / 2 + h.x - 8, top: L.top + L.figH / 3 }}
        />
      ))}

      <div
        className="pointer-events-none absolute left-0 z-10 flex flex-col items-center gap-0.5"
        style={{ top: L.top + L.figH - 14 * L.u, width: L.w }}
      >
        <div className="flex items-center gap-1">
          {chests.map(([kind, ready]) =>
            ready && (!hidden[kind] || fx === kind) ? (
              <button
                key={kind}
                type="button"
                title={`Open ${member.name}'s chest for ${CHEST_PRICE} taps`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => void gift(e, kind)}
                className={`pointer-events-auto relative flex size-8 items-center justify-center rounded-full border-2 border-outline text-foreground shadow-sticker-sm ${
                  kind === "emote" ? "bg-secondary" : "bg-card"
                }`}
              >
                <Gift className="chest-idle size-4 text-primary" />
                {kind === "emote" && (
                  <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full border-2 border-outline bg-card">
                    <Smile className="size-2" />
                  </span>
                )}
                {fx === kind && (
                  <span className="chest-float pointer-events-none absolute -top-3 font-heading text-xs font-bold text-destructive">
                    -{CHEST_PRICE}
                  </span>
                )}
              </button>
            ) : null,
          )}
          <span
            data-solid
            className={`max-w-28 truncate rounded-full border-2 border-outline bg-card px-2 font-heading text-xs font-semibold leading-5 text-foreground shadow-sticker-sm ${
              prefs.showPlayerNames || hovered ? "" : "opacity-0"
            }`}
          >
            {member.name}
          </span>
        </div>
        {err && (
          <p
            className="truncate rounded-full border-2 border-destructive bg-card px-2 text-center text-[10px] leading-4 text-destructive"
            style={{ maxWidth: L.w - 8 }}
          >
            {err}
          </p>
        )}
      </div>
    </div>
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
