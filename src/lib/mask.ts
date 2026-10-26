import { invoke } from "@tauri-apps/api/core";

/** Opaque parts of a sprite as rects in 0..1 of its size; null when it can't be read. */
export type Mask = [number, number, number, number][];

const GRID = 32; // cells per side: ~5 px at a 160 px sprite
const ALPHA = 64; // a cell counts as solid from this (0..255, averaged over the cell)
const MAX = 64; // masks kept; the oldest used one goes first

const cache = new Map<string, Mask | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

/** Calls `f` whenever a mask finished loading; returns the unsubscribe. */
export function onMask(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

/** The sprite's mask: undefined while it loads (call again after `onMask`), null if unreadable. */
export function maskOf(url: string): Mask | null | undefined {
  const m = cache.get(url);
  if (m !== undefined) {
    // most recently used goes last, so eviction drops the stalest
    cache.delete(url);
    cache.set(url, m);
    return m;
  }
  if (!loading.has(url)) {
    loading.add(url);
    void load(url)
      .catch(() => null)
      .then((m) => {
        loading.delete(url);
        cache.set(url, m);
        if (cache.size > MAX) cache.delete(cache.keys().next().value!);
        listeners.forEach((f) => f());
      });
  }
  return undefined;
}

async function load(url: string): Promise<Mask> {
  // the item CDN sends no CORS headers, so Rust fetches those; local/bundled art is same-origin enough
  const blob = url.startsWith("https://")
    ? new Blob([await invoke<ArrayBuffer>("fetch_art", { url })])
    : await (await fetch(url)).blob();
  const g = new OffscreenCanvas(GRID, GRID).getContext("2d")!;
  g.drawImage(await createImageBitmap(blob), 0, 0, GRID, GRID);
  const a = g.getImageData(0, 0, GRID, GRID).data;
  // runs of solid cells per row; a run equal to the one right above extends it downwards
  const out: Mask = [];
  let above: Mask = [];
  for (let y = 0; y < GRID; y++) {
    const row: Mask = [];
    for (let x = 0; x < GRID; x++) {
      if (a[(y * GRID + x) * 4 + 3] < ALPHA) continue;
      const s = x;
      while (x + 1 < GRID && a[(y * GRID + x + 1) * 4 + 3] >= ALPHA) x++;
      const prev = above.find((r) => r[0] === s / GRID && r[2] === (x + 1 - s) / GRID);
      const r = prev ?? [s / GRID, y / GRID, (x + 1 - s) / GRID, 0];
      if (!prev) out.push(r);
      r[3] += 1 / GRID;
      row.push(r);
    }
    above = row;
  }
  return out;
}
