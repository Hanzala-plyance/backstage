// When play starts, give the player a run-up: a count-in before a song, and
// a short rewind when resuming, with nothing judged until the pause point.
export const COUNT_IN = 3;
export const REWIND = 2;
export type Run = {
  /** Where the audio starts, in seconds of the audio file. */
  audioAt: number;
  /** Seconds the song clock runs (negative) before the audio starts. */
  lead: number;
  /** Song time before which input is not judged. */
  guard: number;
};
/** `pausedAt` is the song time when play paused (null for a fresh start);
 * `offset` is the audio offset in seconds (song time = audio time - offset). */
export function runFrom(pausedAt: number | null, offset: number): Run {
  const target = pausedAt === null ? -COUNT_IN : pausedAt - REWIND,
    guard = pausedAt === null ? 0 : pausedAt;
  const audioAt = target + offset;
  return audioAt >= 0
    ? { audioAt, lead: 0, guard }
    : { audioAt: 0, lead: -audioAt, guard };
}
/** The count shown over the highway at song time `t`, or null. */
export function countLabel(t: number, guard: number) {
  if (t < guard) return String(Math.max(1, Math.ceil(guard - t - 1e-6)));
  return t < guard + 0.5 ? "GO!" : null;
}
