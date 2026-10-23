import { useEffect, useRef } from "react";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getAllWebviewWindows, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { remoteLayout, type LobbyState } from "@/lib/lobby";
import type { Prefs } from "@/lib/prefs";

const PREFIX = "cat-";

/** Free-layout spots, written by each cat window when it is dragged (logical px). */
function saved(): Record<string, [number, number]> {
  try {
    return JSON.parse(localStorage.getItem("catPos") ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/**
 * `n` spots of `w x h` beside our cat (logical px), bottoms aligned with it: first to the
 * right, then to the left, then the same again one row higher.
 */
async function rowSpots(n: number, w: number, h: number) {
  const main = getCurrentWindow();
  const sf = await main.scaleFactor();
  const pos = (await main.outerPosition()).toLogical(sf);
  const size = (await main.outerSize()).toLogical(sf);
  const mon = await currentMonitor();
  const minX = mon ? mon.position.x / mon.scaleFactor : -Infinity;
  const maxX = mon ? (mon.position.x + mon.size.width) / mon.scaleFactor : Infinity;
  const spots: [number, number][] = [];
  for (let y = pos.y + size.height - h; spots.length < n; y -= h) {
    const before = spots.length;
    for (let x = pos.x + size.width; x + w <= maxX && spots.length < n; x += w) spots.push([x, y]);
    for (let x = pos.x - w; x >= minX && spots.length < n; x -= w) spots.push([x, y]);
    // no room on this monitor at all: stack to the right
    if (spots.length === before) spots.push([pos.x + size.width, y]);
  }
  return spots;
}

/**
 * Keeps one window per visible lobby member (label `cat-<steamid>`, rendered by RemoteCat).
 * "row" layout lines them up beside our cat and follows it around; "free" puts each where
 * it was last dragged to.
 */
export function useCatWindows(lobby: LobbyState | null, prefs: Prefs) {
  const ids = lobby
    ? lobby.members
        .map((m) => m.id)
        .filter((id) => id !== lobby.me && !prefs.hiddenPlayers.includes(id))
        .slice(0, prefs.maxCats)
    : [];
  const key = ids.join(",");
  const { w, h } = remoteLayout(prefs.remoteCatScale);
  const { catLayout, alwaysOnTop } = prefs;
  // Window calls are async; run syncs one after another so a window is never created twice.
  const chain = useRef(Promise.resolve());

  useEffect(() => {
    let queued = false;
    const sync = async () => {
      const open = (await getAllWebviewWindows()).filter((x) => x.label.startsWith(PREFIX));
      await Promise.all(open.filter((x) => !ids.includes(x.label.slice(PREFIX.length))).map((x) => x.close()));
      const spots = await rowSpots(ids.length, w, h);
      const free = catLayout === "free" ? saved() : {};
      ids.forEach((id, i) => {
        const [x, y] = free[id] ?? spots[i];
        const win = open.find((o) => o.label === PREFIX + id);
        if (!win) {
          new WebviewWindow(PREFIX + id, {
            url: "index.html",
            title: "BongoCatBuddy",
            x,
            y,
            width: w,
            height: h,
            transparent: true,
            decorations: false,
            alwaysOnTop,
            skipTaskbar: true,
            resizable: false,
            shadow: false,
            focus: false,
          });
        } else if (catLayout === "row") {
          void win.setPosition(new LogicalPosition(x, y));
        }
      });
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      chain.current = chain.current.then(() => {
        queued = false;
        return sync();
      }).catch((e) => console.error("cat windows:", e));
    };
    schedule();
    const unMoved = catLayout === "row" ? getCurrentWindow().onMoved(schedule) : null;
    return () => void unMoved?.then((f) => f());
    // `key` stands for `ids`; alwaysOnTop only matters for new windows (each cat applies changes itself)
  }, [key, w, h, catLayout]);
}
