// Guitar rules adapted from YARG.Core (LGPL-3.0). See THIRD_PARTY_NOTICES.md.
import type { Chart, Note } from "../types";
import { Timeline } from "./timeline";
export type Result = "perfect" | "good" | "miss";
type Sustain = {
  index: number;
  lanes: number[];
  end: number;
  from: number;
  released?: number;
  extended: boolean;
  /** Hit by a strum: with `holdStrum`, the strum bar must stay held too. */
  strum: boolean;
};
export function matches(note: Note, held: boolean[]) {
  if (note.open) return !held.some(Boolean);
  if (!note.lanes.every((l) => held[l])) return false;
  const lowest = Math.min(...note.lanes);
  return !held.some(
    (v, l) =>
      v &&
      !note.lanes.includes(l) &&
      ((note.lanes.length > 1 && (note.type ?? "strum") === "strum") ||
        l >= lowest),
  );
}
export class Judgment {
  readonly state: ("pending" | "hit" | "miss")[];
  readonly timeline: Timeline;
  combo = 0;
  maxCombo = 0;
  hits = 0;
  misses = 0;
  overstrums = 0;
  last = "Ready";
  lastHit = -Infinity;
  lastLanes: number[] = [];
  power = 0;
  powerActive = false;
  soloBonus = 0;
  /** For presentation: perfect hits, chords hit, and sustains held to their
   * end (with the lanes of the latest one). */
  perfects = 0;
  chords = 0;
  sustained = 0;
  sustainedLanes: number[] = [];
  private points = 0;
  private cursor = 0;
  private time = 0;
  private held = [false, false, false, false, false];
  private whammy = false;
  private strumHeld = false;
  private readonly holdStrum: boolean;
  private sustains: Sustain[] = [];
  private failedPhrases = new Set<number>();
  private awardedPhrases = new Set<number>();
  private completedSolos = new Set<number>();
  private phraseLast = new Map<number, number>();
  private soloNotes = new Map<number, number[]>();
  private pendingStrum: number | null = null;
  private hopoStrumUntil = -Infinity;
  constructor(
    readonly notes: Note[],
    readonly window = 0.14,
    readonly chart?: Chart,
    /** Strummed sustains need the strum bar held through the tail. */
    options: { holdStrum?: boolean } = {},
  ) {
    this.holdStrum = !!options.holdStrum;
    this.state = notes.map(() => "pending");
    this.timeline = new Timeline(chart?.tempos, chart?.signatures);
    notes.forEach((n, i) => {
      if (n.phrase !== undefined) this.phraseLast.set(n.phrase, i);
      if (n.solo !== undefined) {
        const indexes = this.soloNotes.get(n.solo) ?? [];
        indexes.push(i);
        this.soloNotes.set(n.solo, indexes);
      }
    });
  }
  get score() {
    return Math.floor(this.points + 1e-7) + this.soloBonus;
  }
  get multiplier() {
    return (
      Math.min(4, 1 + Math.floor(this.combo / 10)) * (this.powerActive ? 2 : 1)
    );
  }
  get canActivate() {
    return !this.powerActive && this.power >= 0.5 - 1e-9;
  }
  get accuracy() {
    return this.hits + this.misses
      ? Math.round((100 * this.hits) / (this.hits + this.misses))
      : 100;
  }
  sustainActive(index: number, lane: number) {
    return this.sustains.some(
      (s) => s.index === index && s.lanes.includes(lane) && s.end > this.time,
    );
  }
  finish(time: number) {
    this.advance(time);
    for (let i = this.cursor; i < this.notes.length; i++)
      if (this.state[i] === "pending") {
        this.state[i] = "miss";
        this.misses++;
      }
    this.sustains = [];
    this.pendingStrum = null;
    this.advance(time);
  }
  activate(time: number) {
    this.advance(time);
    if (!this.canActivate) return false;
    this.powerActive = true;
    this.last = "Star Power";
    return true;
  }
  /** Advance before mutating input so intervals use the previous held state.
   * `strumHeld` (when given) is whether the strum bar is held down now. */
  update(
    time: number,
    held: boolean[],
    whammy = false,
    resolveStrum = true,
    strumHeld?: boolean,
  ) {
    this.advance(time);
    this.held = [...held];
    this.whammy = whammy;
    if (strumHeld !== undefined) this.strumHeld = strumHeld;
    for (const s of this.sustains) {
      if (this.sustainHeld(s)) s.released = undefined;
      else s.released ??= time;
    }
    if (
      resolveStrum &&
      this.pendingStrum !== null &&
      time <= this.pendingStrum + 0.05
    )
      return this.tryHit(time, "strum");
    return null;
  }
  private sustainHeld(s: Sustain) {
    if (s.strum && this.holdStrum && !this.strumHeld) return false;
    const n = this.notes[s.index];
    if (n.open) return !this.held.some(Boolean);
    if (s.extended) return s.lanes.every((l) => this.held[l]);
    return matches({ ...n, lanes: s.lanes }, this.held);
  }
  private integrate(end: number) {
    while (end > this.time + 1e-10) {
      const start = this.time,
        rates = this.timeline.rates(start);
      const expires = (s: Sustain) =>
        Math.min(
          s.end,
          s.released === undefined ? Infinity : s.released + 0.06,
        );
      this.sustains = this.sustains.filter((s) => {
        if (expires(s) > start + 1e-10) return true;
        // Held all the way to the end of its tail.
        if (s.released === undefined || s.released + 0.06 >= s.end) {
          this.sustained++;
          this.sustainedLanes = this.notes[s.index].open ? [] : s.lanes;
        }
        return false;
      });
      let stop = Math.min(end, rates.next);
      for (const s of this.sustains) {
        stop = Math.min(stop, expires(s));
        if (s.from > start + 1e-10) stop = Math.min(stop, s.from);
      }
      const active = this.sustains.filter((s) => s.from <= start + 1e-10);
      const gain =
        this.whammy &&
        active.some(
          (s) =>
            this.notes[s.index].phrase !== undefined &&
            !this.failedPhrases.has(this.notes[s.index].phrase!),
        )
          ? rates.beats / 30
          : 0;
      const net = gain - (this.powerActive ? rates.measures / 8 : 0);
      if (this.powerActive && net < 0)
        stop = Math.min(stop, start + this.power / -net);
      this.points +=
        active.length * (stop - start) * rates.beats * 25 * this.multiplier;
      this.power = Math.max(0, Math.min(1, this.power + (stop - start) * net));
      this.time = stop;
      if (this.powerActive && this.power < 1e-9) {
        this.power = 0;
        this.powerActive = false;
      }
    }
    this.time = end;
  }
  advance(time: number) {
    if (!Number.isFinite(time) || time < this.time) return;
    // Process misses/expired strums at their timestamps, not the next render frame.
    while (true) {
      while (
        this.cursor < this.notes.length &&
        this.state[this.cursor] !== "pending"
      )
        this.cursor++;
      const missAt =
        this.cursor < this.notes.length
          ? this.notes[this.cursor].time + this.window
          : Infinity;
      const strumAt =
        this.pendingStrum === null ? Infinity : this.pendingStrum + 0.05;
      const next = Math.min(missAt, strumAt);
      if (next >= time) break;
      this.integrate(Math.max(this.time, next));
      if (strumAt <= missAt) {
        this.pendingStrum = null;
        this.overstrum();
      } else {
        const n = this.notes[this.cursor];
        this.state[this.cursor++] = "miss";
        this.misses++;
        this.combo = 0;
        this.last = "Miss";
        if (n.phrase !== undefined) this.failedPhrases.add(n.phrase);
      }
    }
    this.integrate(time);
    for (const [solo, indexes] of this.soloNotes) {
      if (
        this.completedSolos.has(solo) ||
        this.state[indexes[indexes.length - 1]] === "pending"
      )
        continue;
      const hits = indexes.filter((i) => this.state[i] === "hit").length;
      const percent = hits / indexes.length;
      const bonus =
        Math.floor((100 * hits * Math.max(0, (percent - 0.6) / 0.4)) / 50) * 50;
      this.soloBonus += bonus;
      this.completedSolos.add(solo);
      this.last = `Solo ${Math.round(percent * 100)}% +${bonus}`;
    }
  }
  private overstrum() {
    if (
      this.hits === 0 ||
      (this.cursor >= this.notes.length && this.sustains.length === 0)
    )
      return;
    this.overstrums++;
    this.combo = 0;
    this.sustains = [];
    this.last = "Overstrum";
    const n = this.notes[this.cursor];
    if (
      n?.phrase !== undefined &&
      this.notes[this.cursor - 1]?.phrase === n.phrase
    )
      this.failedPhrases.add(n.phrase);
  }
  strike(time: number, held: boolean[], strumMode: boolean): Result | null {
    // A strum means the bar is down right now.
    this.update(time, held, this.whammy, false, strumMode || undefined);
    if (!strumMode) return this.tryHit(time, "assist");
    if (time <= this.hopoStrumUntil) {
      this.hopoStrumUntil = -Infinity;
      return null;
    }
    if (this.pendingStrum !== null) {
      this.pendingStrum = null;
      this.overstrum();
    }
    const result = this.tryHit(time, "strum");
    if (!result) this.pendingStrum = time;
    return result;
  }
  fret(time: number, held: boolean[]): Result | null {
    const changed = held.some((v, i) => v !== this.held[i]);
    const result = this.update(time, held, this.whammy);
    return result ?? (changed ? this.tryHit(time, "fret") : null);
  }
  private tryHit(
    time: number,
    kind: "strum" | "fret" | "assist",
  ): Result | null {
    const index = this.cursor,
      note = this.notes[index];
    if (!note || Math.abs(note.time - time) > this.window) return null;
    const masked = this.held.map(
      (v, l) =>
        v &&
        !this.sustains.some(
          (s) => s.extended && s.lanes.includes(l) && !note.lanes.includes(l),
        ),
    );
    if (
      kind === "assist"
        ? !note.lanes.every((l) => this.held[l])
        : !matches(note, this.held) && !matches(note, masked)
    )
      return null;
    if (
      kind === "fret" &&
      !(
        note.type === "tap" ||
        (note.type === "hopo" && (this.combo > 0 || index === 0))
      )
    )
      return null;
    this.state[index] = "hit";
    this.cursor++;
    this.hits++;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.points += 50 * Math.max(1, note.lanes.length) * this.multiplier;
    this.lastHit = time;
    this.lastLanes = note.open ? [0, 1, 2, 3, 4] : note.lanes;
    this.pendingStrum = null;
    if (kind === "fret") this.hopoStrumUntil = time + 0.05;
    const tails =
      note.tails ??
      (note.open
        ? [{ lane: -1, duration: note.duration }]
        : note.lanes.map((lane) => ({ lane, duration: note.duration })));
    // Equal chord tails score once; disjoint ends score separately.
    const groups = new Map<number, number[]>();
    for (const tail of tails)
      if (tail.duration > 0)
        groups.set(tail.duration, [
          ...(groups.get(tail.duration) ?? []),
          tail.lane,
        ]);
    for (const [duration, lanes] of groups) {
      const end = note.time + duration;
      if (end > time)
        this.sustains.push({
          index,
          lanes,
          end,
          from: Math.max(note.time, time),
          strum: kind === "strum",
          extended:
            groups.size > 1 || (this.notes[index + 1]?.time ?? Infinity) < end,
        });
    }
    if (
      note.phrase !== undefined &&
      this.phraseLast.get(note.phrase) === index &&
      !this.failedPhrases.has(note.phrase) &&
      !this.awardedPhrases.has(note.phrase)
    ) {
      this.power = Math.min(1, this.power + 0.25);
      this.awardedPhrases.add(note.phrase);
    }
    const perfect = Math.abs(note.time - time) <= 0.055;
    if (perfect) this.perfects++;
    if (note.lanes.length > 1) this.chords++;
    this.last = perfect ? "Perfect" : "Good";
    return perfect ? "perfect" : "good";
  }
}
