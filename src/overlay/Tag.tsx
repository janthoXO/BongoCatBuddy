import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Something the tag turns into for a while: a speech bubble (`text`), an item popup or the chat
 * input (`node`). With `ms` it ends by itself (`onDone`), not while hovered nor before a long
 * bubble has scrolled through; without, it stays until the parent drops it.
 */
export type TagEvent = {
  k: string | number;
  text?: string;
  node?: ReactNode;
  ms?: number;
  onDone?: () => void;
  onClick?: () => void;
  title?: string;
};

/**
 * Tells the overlay a tag starts or ends resizing: it reports the new hit rects, and keeps its
 * window over every tag (`data-extent`: the pill as it is now and the size it grows to).
 */
export const TAG_CHANGED = "tag-changed";

const LINES = 2; // a bubble shows this many lines, longer ones scroll
const LINE = 14; // px
const SCROLL = 14; // px/s autoscroll, about a line a second
const LEAD = 1200; // ms read the first lines before scrolling
const TAIL = 2000; // ms on the last lines

/**
 * The score / name tag under a cat, and the one place its events show: the pill morphs from the
 * tag (or, hidden, from the tiny dots pill) into the event, lies over whatever is below for the
 * time of it, then morphs back. Its slot in the row keeps the tag's size, so nothing moves; the
 * pill floats (`data-float`, not measured as what the cat shows) and is its own hover target
 * (`hit`; it may lie over another cat's box). Hovered (`held`) an event stays and a bubble stops
 * scrolling, wheel / two-finger scroll moves it then.
 *
 * `look`: "show" the tag, "dim" it (on hover only, hovered), "collapse" it to the dots pill, one
 * dot per ready chest (left = chest, right = emote chest).
 */
export function Tag({
  rest, look, dots, event, onClick, title, max, hit, held,
}: {
  rest: ReactNode;
  look: "show" | "dim" | "collapse";
  dots: [boolean, boolean];
  event: TagEvent | null;
  onClick: () => void;
  title: string;
  /** widest an event may grow, px */
  max: number;
  /** hover id of the pill (`data-hit`) */
  hit: string;
  /** the pointer is over the pill */
  held: boolean;
}) {
  const collapsed = !event && look === "collapse";
  const k = event ? `e${event.k}` : collapsed ? "dots" : "rest";
  const scroller = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(0); // px a bubble's text is taller than its lines
  const body = (live: boolean) =>
    event?.text !== undefined ? (
      <div className="px-2.5 py-[5px]">
        <div
          ref={live ? scroller : undefined}
          className={`tag-scroll overflow-y-auto ${live && over ? "tag-fade" : ""}`}
          style={{ maxHeight: LINES * LINE }}
        >
          <p className="break-words text-center text-xs text-foreground" style={{ lineHeight: `${LINE}px` }}>
            {event.text}
          </p>
        </div>
      </div>
    ) : event ? (
      event.node
    ) : collapsed ? (
      <span className="flex h-2.5 w-6 items-center gap-0.5 px-[3px]">
        {dots.map((on, i) => (
          <span key={i} className={`size-1 rounded-full ${on ? "bg-primary" : ""}`} />
        ))}
      </span>
    ) : (
      rest
    );

  // the pill takes the size of what it shows, measured off-flow (`w-max`, up to `max`)
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const read = () => setSize((s) => (s?.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    const sc = scroller.current;
    setOver(sc ? Math.max(0, sc.scrollHeight - sc.clientHeight) : 0);
    return () => ro.disconnect();
  }, [k]);
  useEffect(() => void dispatchEvent(new Event(TAG_CHANGED)), [size?.w, size?.h]);

  // a long bubble scrolls through by itself; hovered it stops, the wheel scrolls it then
  useEffect(() => {
    const el = scroller.current;
    if (!el || !over || held) return;
    let pos = el.scrollTop;
    let last = 0;
    let id = 0;
    const start = performance.now() + (pos ? 0 : LEAD);
    const step = (t: number) => {
      if (t >= start) {
        pos = Math.min(over, pos + (last ? (SCROLL * (t - last)) / 1000 : 0));
        el.scrollTop = pos;
        last = t;
      }
      if (pos < over) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [k, over, held]);

  // ends by itself after `ms` (and the scroll through), counted again after a hover
  const done = useRef(event?.onDone);
  done.current = event?.onDone;
  const ms = event?.ms;
  useEffect(() => {
    if (!ms || held) return;
    const t = setTimeout(() => done.current?.(), Math.max(ms, over ? LEAD + (over / SCROLL) * 1000 + TAIL : 0));
    return () => clearTimeout(t);
  }, [k, ms, over, held]);

  // what it showed before fades out while the new content fades in
  const last = useRef({ k, node: body(false) });
  const [leaving, setLeaving] = useState<{ k: string; node: ReactNode } | null>(null);
  useLayoutEffect(() => {
    if (last.current.k === k) return;
    setLeaving(last.current);
    const t = setTimeout(() => setLeaving(null), 200);
    return () => clearTimeout(t);
  }, [k]);
  useEffect(() => {
    last.current = { k, node: body(false) };
  });

  // no morph on mount, only between states
  const [anim, setAnim] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnim(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const h = size?.h ?? 24;
  const click = event ? event.onClick : onClick;
  const layer = "absolute left-1/2 top-0 w-max -translate-x-1/2";
  return (
    <div className="relative">
      {/* the slot: the tag's size, so the chests and buttons around it stay put */}
      <div data-solid aria-hidden className="invisible">{rest}</div>
      <div data-float className="absolute left-1/2 top-0 z-10 -translate-x-1/2">
        <div
          data-solid
          data-extent
          data-hit={hit}
          role={click ? "button" : undefined}
          title={event ? event.title : title}
          onPointerDown={(e) => click && e.stopPropagation()}
          onClick={(e) => {
            if (!click) return;
            e.stopPropagation();
            click();
          }}
          onTransitionEnd={(e) => e.target === e.currentTarget && dispatchEvent(new Event(TAG_CHANGED))}
          className={`${anim ? "tag" : ""} pill pointer-events-auto relative overflow-hidden ${look === "dim" && !event ? "opacity-60" : ""}`}
          style={{ width: size?.w ?? 0, height: h, marginTop: Math.max(0, (24 - h) / 2), borderRadius: Math.min(12, h / 2) }}
        >
          {leaving && (
            <div key={leaving.k} className={`${layer} tag-out`} style={{ maxWidth: max }}>
              {leaving.node}
            </div>
          )}
          <div ref={inner} data-extent key={k} className={`${layer} ${anim ? "tag-in" : ""}`} style={{ maxWidth: max }}>
            {body(true)}
          </div>
        </div>
      </div>
    </div>
  );
}
