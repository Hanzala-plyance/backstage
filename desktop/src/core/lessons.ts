import type { Chart, Note } from "../types";
import type { Judgment } from "./judgment";
import { baseScore } from "./stars";
// Soundcheck lessons: short 120 BPM charts that fit the 32 s practice backing,
// each with a goal the player must meet after watching a demo. Each
// instrument has its own set in the same order, so a band can take a lesson
// together (a vocals set can join later).
const BEAT = 0.5,
  START = 3;
export const laneNames = ["Green", "Red", "Yellow", "Blue", "Orange"];
export const drumNames = ["Kick", "Snare", "Hi-hat", "Tom", "Cymbal"];
type Goal =
  | { kind: "hits"; target: number }
  | { kind: "sustain"; target: number }
  | { kind: "streak"; target: number }
  | { kind: "power" };
export type Lesson = {
  id: string;
  title: string;
  summary: string;
  /** What to do, in order; `{frets}`, `{strum}` and `{power}` name the
   * player's own controls. */
  steps: string[];
  goal: Goal;
  notes: Note[];
  instrument?: "guitar" | "drums";
};
const note = (
  beat: number,
  lanes: number[],
  extra: Partial<Note> = {},
): Note => ({
  time: START + beat * BEAT,
  duration: 0,
  lanes,
  type: "strum",
  ...extra,
});
export const lessons: Lesson[] = [
  {
    id: "frets",
    title: "Frets & strum",
    summary: "Hit single notes as they cross the line.",
    steps: [
      "Gems ride down the highway toward the strike line.",
      "Each lane matches a fret: green, red, yellow, blue, orange ({frets}).",
      "Hold the matching fret, then {strum} as the gem reaches the line.",
    ],
    goal: { kind: "hits", target: 9 },
    notes: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 0, 2, 4, 1, 3].map((lane, i) =>
      note(i * 2, [lane]),
    ),
  },
  {
    id: "chords",
    title: "Chords",
    summary: "Hold two or three frets and strum once.",
    steps: [
      "Gems side by side form a chord.",
      "Hold every fret in the chord, then {strum} once.",
    ],
    goal: { kind: "hits", target: 5 },
    notes: [
      [0, 1],
      [0, 1],
      [1, 2],
      [1, 2],
      [0, 2],
      [2, 3],
      [3, 4],
      [0, 1, 2],
    ].map((lanes, i) => note(i * 2.5, lanes)),
  },
  {
    id: "sustains",
    title: "Sustains",
    summary: "Keep holding long notes for bonus points.",
    steps: [
      "A gem with a tail is a sustain.",
      "Hit it, then keep the fret held until the tail ends.",
      "Letting go early drops the bonus points.",
    ],
    goal: { kind: "sustain", target: 0.6 },
    notes: [0, 1, 2, 0].map((lane, i) =>
      note(i * 6, [lane], { duration: 3 * BEAT }),
    ),
  },
  {
    id: "hopos",
    title: "HOPOs & taps",
    summary: "Hammer on quick notes without strumming.",
    steps: [
      "White-capped gems are HOPOs (hammer-ons and pull-offs).",
      "Strum the first note, then just press the next frets in time; no strum needed.",
      "Keep a streak going: a miss means strumming again.",
    ],
    goal: { kind: "hits", target: 7 },
    notes: [
      [0, 1, 2],
      [2, 1, 0],
      [1, 2, 3],
      [3, 2, 1],
    ].flatMap((group, g) =>
      group.map((lane, i) =>
        note(g * 5 + i, [lane], { type: i ? "hopo" : "strum" }),
      ),
    ),
  },
  {
    id: "power",
    title: "Star Power",
    summary: "Fill the meter with glowing phrases, then ignite it.",
    steps: [
      "Glowing gems form a Star Power phrase. Hit every gem in it to charge the meter.",
      "Two phrases fill the meter halfway, enough to use it.",
      "Press {power} to ignite: your score doubles while it lasts.",
    ],
    goal: { kind: "power" },
    notes: [
      ...[0, 1, 2, 3].map((lane, i) => note(i * 1.5, [lane], { phrase: 0 })),
      ...[3, 2, 1, 0].map((lane, i) =>
        note(8 + i * 1.5, [lane], { phrase: 1 }),
      ),
      ...[0, 2, 4, 2, 0, 2, 4, 2].map((lane, i) => note(18 + i * 2, [lane])),
    ],
  },
  {
    id: "streak",
    title: "Streaks & multiplier",
    summary: "Chain notes to raise your score multiplier.",
    steps: [
      "Every 10 notes in a row raises your multiplier, up to 4×.",
      "A miss resets the streak, so stay steady.",
      "Reach a 15-note streak to pass.",
    ],
    goal: { kind: "streak", target: 15 },
    notes: Array.from({ length: 32 }, (_, i) =>
      note(i, [[0, 1, 2, 1, 0, 2, 3, 2][i % 8] + (i >= 16 ? 1 : 0)]),
    ),
  },
];
const hit = (beat: number, lanes: number[], extra: Partial<Note> = {}) =>
  note(beat, lanes, { type: undefined, ...extra });
const BEAT_LANES = [[0, 2], [2], [1, 2], [2]];
/** Drum lessons, in the same order as the guitar ones. Lanes: kick, snare,
 * hi-hat, tom, cymbal. */
export const drumLessons: Lesson[] = [
  {
    id: "drums-pads",
    instrument: "drums",
    title: "Pads & kick",
    summary: "Hit each pad as its gem crosses the line.",
    steps: [
      "Gems ride down the highway; each lane is a pad: kick, snare, hi-hat, tom, cymbal ({pads}).",
      "Hit the matching pad, or stomp the kick pedal, as the gem reaches the line.",
      "Keep your sticks loose and steady.",
    ],
    goal: { kind: "hits", target: 9 },
    notes: [1, 1, 2, 2, 3, 3, 4, 4, 0, 0, 1, 3, 0, 2, 4].map((lane, i) =>
      hit(i * 2, [lane]),
    ),
  },
  {
    id: "drums-doubles",
    instrument: "drums",
    title: "Two at once",
    summary: "Kick and a pad together.",
    steps: [
      "Gems side by side are hit together.",
      "Most two-gem hits are the kick with a pad or cymbal: land them at the same moment.",
    ],
    goal: { kind: "hits", target: 5 },
    notes: [
      [0, 4],
      [0, 1],
      [0, 2],
      [1, 4],
      [0, 3],
      [0, 1],
      [2, 3],
      [0, 4],
    ].map((lanes, i) => hit(i * 2.5, lanes)),
  },
  {
    id: "drums-beat",
    instrument: "drums",
    title: "Steady beat",
    summary: "The rock beat: kick, hat, snare, hat.",
    steps: [
      "Keep time on the hi-hat every beat.",
      "Add the kick on beat one and the snare on beat three.",
      "Count it: kick-hat, hat, snare-hat, hat.",
    ],
    goal: { kind: "hits", target: 12 },
    notes: Array.from({ length: 16 }, (_, i) => hit(i * 2, BEAT_LANES[i % 4])),
  },
  {
    id: "drums-fills",
    instrument: "drums",
    title: "Fills",
    summary: "Quick runs across the toms, then a crash.",
    steps: [
      "A fill is a quick run across the drums between beats.",
      "Play the snare and tom gems in time, then land the crash with the kick.",
    ],
    goal: { kind: "hits", target: 11 },
    notes: [0, 1, 2].flatMap((g) => [
      ...[1, 1, 3, 3].map((lane, i) => hit(g * 6 + i, [lane])),
      hit(g * 6 + 4, [0, 4]),
    ]),
  },
  {
    id: "drums-power",
    instrument: "drums",
    title: "Star Power",
    summary: "Fill the meter with glowing phrases, then ignite it.",
    steps: [
      "Glowing gems form a Star Power phrase. Hit every gem in it to charge the meter.",
      "Two phrases fill the meter halfway, enough to use it.",
      "Press {power} to ignite: your score doubles while it lasts.",
    ],
    goal: { kind: "power" },
    notes: [
      ...[1, 2, 3, 4].map((lane, i) => hit(i * 1.5, [lane], { phrase: 0 })),
      ...[4, 3, 2, 1].map((lane, i) => hit(8 + i * 1.5, [lane], { phrase: 1 })),
      ...[0, 2, 1, 2, 0, 2, 1, 2].map((lane, i) => hit(18 + i * 2, [lane])),
    ],
  },
  {
    id: "drums-streak",
    instrument: "drums",
    title: "Streaks & multiplier",
    summary: "Chain hits to raise your score multiplier.",
    steps: [
      "Every 10 hits in a row raises your multiplier, up to 4×.",
      "A miss resets the streak, so stay steady.",
      "Reach a 15-hit streak to pass.",
    ],
    goal: { kind: "streak", target: 15 },
    notes: Array.from({ length: 32 }, (_, i) => hit(i, BEAT_LANES[i % 4])),
  },
];
/** The lesson set for an instrument. */
export const lessonsFor = (part: string) =>
  part === "Drums" ? drumLessons : lessons;
export function lessonChart(lesson: Lesson): Chart {
  return {
    part: lesson.instrument === "drums" ? "Drums" : "Guitar",
    level: "Easy",
    tempos: [{ time: 0, bpm: 120 }],
    signatures: [{ time: 0, numerator: 4, denominator: 4 }],
    notes: lesson.notes,
  };
}
/** When a lesson run is over: a moment after the last note (or its tail). */
export function lessonEnd(lesson: Lesson) {
  const last = lesson.notes[lesson.notes.length - 1];
  return last.time + last.duration + 1.5;
}
export function goalText(goal: Goal, total: number) {
  switch (goal.kind) {
    case "hits":
      return `Hit ${goal.target} of ${total} notes`;
    case "sustain":
      return `Earn ${Math.round(goal.target * 100)}% of the sustain points`;
    case "streak":
      return `Reach a ${goal.target}-note streak`;
    case "power":
      return "Charge and ignite Star Power";
  }
}
export type Performance = {
  hits: number;
  score: number;
  maxCombo: number;
  usedPower: boolean;
};
/** Grades a run; `value` is shown to the player. */
export function lessonResult(lesson: Lesson, run: Performance) {
  const goal = lesson.goal;
  switch (goal.kind) {
    case "hits":
      return {
        passed: run.hits >= goal.target,
        value: `${run.hits} of ${lesson.notes.length} notes hit`,
      };
    case "sustain": {
      const share = run.score / baseScore(lessonChart(lesson));
      return {
        passed: share >= goal.target - 1e-9,
        value: `${Math.min(100, Math.round(share * 100))}% of the points earned`,
      };
    }
    case "streak":
      return {
        passed: run.maxCombo >= goal.target,
        value: `Best streak ${run.maxCombo}`,
      };
    case "power":
      return {
        passed: run.usedPower,
        value: run.usedPower ? "Star Power ignited" : "Star Power not used",
      };
  }
}
/** Names the frets and action for a note, e.g. "Green + Red · Strum". */
export function cueFor(n: Note, strumMode: boolean, drums = false) {
  if (drums) return `${n.lanes.map((l) => drumNames[l]).join(" + ")} · Hit`;
  const frets = n.lanes.map((l) => laneNames[l]).join(" + ");
  const action =
    n.type === "hopo" || n.type === "tap"
      ? "Hammer on"
      : strumMode
        ? "Strum"
        : "Press";
  return `${frets} · ${action}${n.duration > 0 ? " and hold" : ""}`;
}
export type DemoInput = { lanes: boolean[]; strum: boolean; power: boolean };
const LEAD = 0.1,
  TAP = 0.12;
/** Plays a chart perfectly for lesson demos: frets go down just before strum
 * notes (at the note for hammer-ons) and stay down through sustains. */
export class DemoPlayer {
  private strummed = -1;
  private cursor = 0;
  constructor(
    private readonly notes: Note[],
    private readonly strumMode: boolean,
    private readonly power = false,
  ) {}
  private strumNote(n: Note) {
    return (n.type ?? "strum") === "strum";
  }
  private start(n: Note) {
    return n.time - (this.strumMode && this.strumNote(n) ? LEAD : 0);
  }
  input(t: number): DemoInput {
    while (
      this.cursor + 1 < this.notes.length &&
      this.start(this.notes[this.cursor + 1]) <= t
    )
      this.cursor++;
    const n = this.notes[this.cursor];
    const lanes = [false, false, false, false, false];
    if (!n || this.start(n) > t)
      return { lanes, strum: false, power: this.power };
    if (t < n.time + Math.max(n.duration, TAP))
      n.lanes.forEach((l) => (lanes[l] = true));
    const strum =
      this.strumMode &&
      this.strumNote(n) &&
      t >= n.time &&
      this.strummed < this.cursor;
    if (strum) this.strummed = this.cursor;
    return { lanes, strum, power: this.power };
  }
}
/** Feeds demo input to a judge the way a pad's input reaches it, so demos
 * follow the real rules. Returns the frets now held. */
export function applyDemo(
  judge: Judgment,
  t: number,
  previous: boolean[],
  input: DemoInput,
  strumMode: boolean,
) {
  const held = input.lanes;
  if (strumMode) {
    if (input.strum) judge.strike(t, held, true);
    else if (held.some((v, i) => v !== previous[i])) judge.fret(t, held);
  } else if (held.some((v, i) => v && !previous[i]))
    judge.strike(t, held, false);
  if (input.power && judge.canActivate) judge.activate(t);
  judge.update(t, held);
  return held;
}
/** Controller check: every input a player needs, named for their device. */
export type CheckItem = { id: string; label: string; hint: string };
export function checkItems(pad: boolean): CheckItem[] {
  const frets = laneNames.map((name, i) => ({
    id: `lane${i}`,
    label: name,
    hint: pad ? "Fret" : "ASDFG"[i],
  }));
  return pad
    ? [
        ...frets,
        { id: "strumUp", label: "Strum up", hint: "Strum bar" },
        { id: "strumDown", label: "Strum down", hint: "Strum bar" },
        { id: "starPower", label: "Star Power", hint: "Button or tilt" },
        { id: "whammy", label: "Whammy", hint: "Bar" },
        { id: "pause", label: "Start", hint: "Pause" },
      ]
    : [
        ...frets,
        { id: "strum", label: "Strum", hint: "Space" },
        { id: "starPower", label: "Star Power", hint: "Shift" },
        { id: "whammy", label: "Whammy", hint: "W" },
      ];
}
/** The check for a device: pad, keyboard, or a MIDI drum kit's pads. */
export function checkItemsFor(device: string): CheckItem[] {
  if (device === "midi")
    return drumNames.map((name, i) => ({
      id: `lane${i}`,
      label: name,
      hint: i ? "Pad" : "Pedal",
    }));
  return checkItems(device.startsWith("pad:"));
}
/** Check items active in a pad's state. */
export function padActive(state: {
  lanes: boolean[];
  strumUp: boolean;
  strumDown: boolean;
  starPower: boolean;
  whammy: boolean;
  pause: boolean;
}) {
  const ids = state.lanes.flatMap((on, i) => (on ? [`lane${i}`] : []));
  for (const id of [
    "strumUp",
    "strumDown",
    "starPower",
    "whammy",
    "pause",
  ] as const)
    if (state[id]) ids.push(id);
  return ids;
}
/** Check item for a keyboard key, if any. */
export function keyItem(code: string) {
  const lane = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG"].indexOf(code);
  if (lane >= 0) return `lane${lane}`;
  if (["Space", "ArrowUp", "ArrowDown"].includes(code)) return "strum";
  if (code.startsWith("Shift")) return "starPower";
  if (code === "KeyW") return "whammy";
  return null;
}
