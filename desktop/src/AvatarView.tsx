import { useEffect, useState } from "react";
import type { Gear, Look } from "./core/avatars";
import { createStage } from "./game/stage3d";
const portraits = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
const keyOf = (look: Look) =>
  look.kind === "preset"
    ? look.id
    : `photo:${look.image.length}:${look.image.slice(-48)}`;
/** A rendered head-and-shoulders picture of a look, made once and cached.
 * Renders one at a time so thumbnails never hold many GL contexts. */
export function portrait(look: Look, gear?: Gear) {
  // Gear changes the guitar in the picture, so it is part of the cache key.
  const key = keyOf(look) + (gear ? `:${gear.guitar}:${gear.finish}` : "");
  let made = portraits.get(key);
  if (!made) {
    const next: Promise<string> = queue.then(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 160;
      const stage = await createStage(
        canvas,
        [{ look, instrument: "guitar", gear }],
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
  gear,
  className = "",
}: {
  look: Look;
  /** Shows the player's own guitar shape and finish. */
  gear?: Gear;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    portrait(look, gear)
      .then((u) => alive && setUrl(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [keyOf(look), gear?.guitar, gear?.finish]);
  return (
    <span className={"portrait " + className}>
      {url && <img src={url} alt="" />}
    </span>
  );
}
