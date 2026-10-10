import type { Chart, Part } from "../types";
import { Timeline } from "./timeline";
// YARG.Core star thresholds as fractions of a chart's base score.
const THRESHOLDS: Record<"guitar" | "drums", number[]> = {
  guitar: [0.21, 0.46, 0.77, 1.85, 3.08, 4.52],
  drums: [0.21, 0.46, 0.77, 1.85, 3.08, 4.29],
};
/** Points a full combo earns at 1x without Star Power or solo bonuses:
 * 50 per gem and 25 per sustained beat (equal chord tails count once). */
export function baseScore(
  chart: Pick<Chart, "notes" | "tempos" | "signatures">,
) {
  const timeline = new Timeline(chart.tempos, chart.signatures);
  let points = 0;
  for (const note of chart.notes) {
    points += 50 * Math.max(1, note.lanes.length);
    const tails =
      note.tails ??
      note.lanes.map((lane) => ({ lane, duration: note.duration }));
    const lengths = new Set(
      (tails.length ? tails : [{ lane: -1, duration: note.duration }])
        .map((t) => t.duration)
        .filter((d) => d > 0),
    );
    for (const length of lengths)
      points +=
        25 *
        (timeline.position(note.time + length).beat -
          timeline.position(note.time).beat);
  }
  return points;
}
/** 0–6 stars; 6 is gold. */
export function starsFor(score: number, base: number, part: Part) {
  if (!(base > 0) || !(score > 0)) return 0;
  const ratio = score / base;
  return THRESHOLDS[part === "Drums" ? "drums" : "guitar"].filter(
    (t) => ratio >= t,
  ).length;
}
