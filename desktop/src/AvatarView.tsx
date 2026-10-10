import { useEffect, useRef, useState } from "react";
import type { Instrument, Look } from "./core/avatars";
import { createStage, type PerformerState } from "./game/stage3d";
const portraits = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
const keyOf = (look: Look) =>
  look.kind === "preset"
    ? look.id
    : `photo:${look.image.length}:${look.image.slice(-48)}`;
/** A rendered head-and-shoulders picture of a look, made once and cached.
 * Renders one at a time so thumbnails never hold many GL contexts. */
export function portrait(look: Look) {
  const key = keyOf(look);
  let made = portraits.get(key);
  if (!made) {
    const next: Promise<string> = queue.then(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const stage = await createStage(
        canvas,
        [{ look, instrument: "guitar" }],
        { portrait: true, pixelRatio: 1 },
      );
      stage.frame(
        0,
        [{ hits: 0, misses: 0, combo: 0, powerActive: false }],
        false,
        0.5,
        true,
      );
      const url = stage.snapshot();
      stage.dispose();
      return url;
    });
    queue = next.catch(() => {});
    portraits.set(key, (made = next));
  }
  return made;
}
export function Portrait({
  look,
  className = "",
}: {
  look: Look;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    portrait(look)
      .then((u) => alive && setUrl(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [keyOf(look)]);
  return (
    <span className={"portrait " + className}>
      {url && <img src={url} alt="" />}
    </span>
  );
}
/** Live 3D preview: the performer plays to a steady beat and runs through
 * its moods (groove, streak, Star Power, miss). */
export function StagePreview({
  look,
  instrument,
}: {
  look: Look;
  instrument: Instrument;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let alive = true,
      frame = 0;
    let dispose = () => {};
    void createStage(canvas.current!, [{ look, instrument }], {
      pixelRatio: 1.5,
    })
      .then((stage) => {
        if (!alive) return stage.dispose();
        dispose = stage.dispose;
        const start = performance.now();
        const state: PerformerState = {
          hits: 0,
          misses: 0,
          combo: 0,
          powerActive: false,
        };
        const tick = (now: number) => {
          const t = (now - start) / 1000;
          const cycle = Math.floor(t / 2.4) % 4;
          state.hits = Math.floor(t / 0.5);
          state.combo = cycle === 1 ? 12 : 3;
          state.powerActive = cycle === 2;
          if (cycle === 3) state.misses = Math.floor(t / 2.4);
          stage.frame(t, [state], true, 0.5);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      })
      .catch(() => {});
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      dispose();
    };
  }, [keyOf(look), instrument]);
  return (
    <canvas
      ref={canvas}
      className="stage-preview"
      aria-label="Avatar preview"
    />
  );
}
