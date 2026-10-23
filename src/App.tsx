import { useEffect, useRef, useState } from "react";
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

const UNIT = 1.25; // px per unit, tweak to resize
const HIT_MS = 100;

type Score = { current: number; lifetime: number };

const placeholders = {
  catLeft, catLeftPunch, catRight, catRightPunch,
  bongoLeft, bongoLeftPunch, bongoRight, bongoRightPunch,
};
type Art = Record<keyof typeof placeholders, string>;

// Layers in draw order (first = back); `show` says when it is visible.
const layers = (a: Art, l: boolean, r: boolean) => [
  { src: a.bongoLeftPunch, x: -16, y: -31, show: l },
  { src: a.catLeft, x: -6, y: 10, show: !l },
  { src: a.catLeftPunch, x: -6, y: 10, show: l },
  { src: a.bongoLeft, x: -16, y: -31, show: !l },
  { src: a.bongoRight, x: -16, y: -31, show: !r },
  { src: a.bongoRightPunch, x: -16, y: -31, show: r },
  { src: a.catRight, x: -6, y: 10, show: !r },
  { src: a.catRightPunch, x: -6, y: 10, show: r },
];

function App() {
  const [art, setArt] = useState<Art>(placeholders);
  const [score, setScore] = useState<Score | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const [right, setRight] = useState(false);
  const wasLeft = useRef(false);
  const punching = useRef({ left: false, right: false });

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

  return (
    <main className="flex h-svh flex-col items-center justify-center gap-1">
      <div
        data-tauri-drag-region
        className="relative"
        style={{ width: 138 * UNIT, height: 169 * UNIT }}
      >
        {layers(art, left, right).map((l) => (
          <img
            key={l.src}
            src={l.src}
            draggable={false}
            className={`pointer-events-none absolute ${l.show ? "" : "invisible"}`}
            style={{
              left: (80 + l.x - 64) * UNIT,
              top: (74 - l.y - 64) * UNIT,
              width: 128 * UNIT,
              height: 128 * UNIT,
            }}
          />
        ))}
      </div>
      <span
        title={score ? `Lifetime: ${score.lifetime}` : undefined}
        className="rounded-full bg-background/80 px-2 font-medium tabular-nums text-foreground"
      >
        {score ? score.current.toLocaleString("en-US").replace(/,/g, " ") : "…"}
      </span>
      {error && <p className="px-2 text-center text-xs text-muted-foreground">{error}</p>}
    </main>
  );
}

export default App;
