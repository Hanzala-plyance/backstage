import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Judgment, matches } from "../src/core/judgment";
import { Timeline } from "../src/core/timeline";
import type { Note, Chart } from "../src/types";
const require = createRequire(import.meta.url);
const { Midi } = require("@tonejs/midi");
const { parseMidi } = require("../electron/chart.cjs");
const held = (...lanes: number[]) =>
  [0, 1, 2, 3, 4].map((l) => lanes.includes(l));
const note = (time: number, lanes = [0], extra: Partial<Note> = {}): Note => ({
  time,
  lanes,
  duration: 0,
  ...extra,
});
const chart = (notes: Note[], extra: Partial<Chart> = {}): Chart => ({
  part: "Guitar",
  level: "Expert",
  notes,
  ...extra,
});
test("YARG note values, chord weights and multiplier boundaries are independent of timing grade", () => {
  const notes = Array.from({ length: 31 }, (_, i) =>
    note(i + 1, i === 9 ? [0, 2] : [0]),
  );
  const j = new Judgment(notes);
  notes.forEach((n, i) => {
    j.strike(n.time + (i % 2 ? 0.09 : 0), held(...n.lanes), true);
    assert.equal(j.multiplier, Math.min(4, 1 + Math.floor((i + 1) / 10)));
  });
  assert.equal(j.score, 3450); // 9*50 + 11*100 (one extra chord gem) + 10*150 + 2*200
});
test("single anchoring, exact strum chords, HOPO chord anchoring and open frets", () => {
  assert.equal(matches(note(1, [3]), held(0, 1, 3)), true);
  assert.equal(matches(note(1, [3]), held(3, 4)), false);
  assert.equal(matches(note(1, [1, 3]), held(0, 1, 3)), false);
  assert.equal(matches(note(1, [1, 3], { type: "hopo" }), held(0, 1, 3)), true);
  assert.equal(
    matches(note(1, [1, 3], { type: "hopo" }), held(1, 2, 3)),
    false,
  );
  assert.equal(matches(note(1, [], { open: true }), held()), true);
  assert.equal(matches(note(1, [], { open: true }), held(0)), false);
});
test("hammer-ons, pull-offs, chain breaks, tap recovery and one forgiven HOPO strum", () => {
  const j = new Judgment([
    note(1),
    note(1.3, [2], { type: "hopo" }),
    note(1.6, [0], { type: "hopo" }),
    note(2, [1]),
    note(2.3, [3], { type: "hopo" }),
    note(2.6, [4], { type: "tap" }),
  ]);
  j.strike(1, held(0), true);
  assert.equal(j.fret(1.3, held(0, 2)), "perfect");
  j.strike(1.32, held(0, 2), true);
  assert.equal(j.combo, 2);
  assert.equal(j.fret(1.6, held(0)), "perfect");
  j.advance(2.2);
  assert.equal(j.combo, 0);
  assert.equal(j.fret(2.3, held(3)), null);
  j.advance(2.5);
  assert.equal(j.fret(2.6, held(4)), "perfect");
  assert.equal(j.combo, 1);
});
test("repeated held taps do not score and strum-required notes cannot be tapped", () => {
  const j = new Judgment([
    note(1),
    note(2, [1], { type: "tap" }),
    note(3, [1], { type: "tap" }),
  ]);
  assert.equal(j.fret(1, held(0)), null);
  j.strike(1, held(0), true);
  assert.equal(j.fret(2, held(1)), "perfect");
  assert.equal(j.fret(3, held(1)), null);
});
test("strum-before-fret grace resolves once; stray strums reset streak and prevent phrase award", () => {
  const j = new Judgment([
    note(1, [0], { phrase: 0 }),
    note(2, [1], { phrase: 0 }),
  ]);
  j.strike(0.98, held(), true);
  j.fret(1.01, held(0));
  assert.equal(j.hits, 1);
  j.strike(1.4, held(0), true);
  j.advance(1.46);
  assert.equal(j.combo, 0);
  assert.equal(j.overstrums, 1);
  j.strike(2, held(1), true);
  assert.equal(j.power, 0);
  assert.equal(j.hits, 2);
});
test("sustain score uses beats across tempo changes and release cannot resume dropped tails", () => {
  const notes = [note(0, [0], { duration: 2 })],
    c = chart(notes, {
      tempos: [
        { time: 0, bpm: 120 },
        { time: 1, bpm: 60 },
      ],
    });
  const j = new Judgment(notes, 0.14, c);
  j.strike(0, held(0), true);
  j.advance(2);
  assert.equal(j.score, 125);
  const drop = new Judgment(notes, 0.14, c);
  drop.strike(0, held(0), true);
  drop.update(0.5, held());
  drop.update(1, held(0));
  drop.advance(2);
  assert.equal(drop.score, 78); // 50 + 25 * 2 * (.5 + .06 grace)
});
test("equal chord sustains score once; disjoint tails score independently while extended frets are masked", () => {
  const n = note(0, [0, 2], {
    duration: 2,
    tails: [
      { lane: 0, duration: 2 },
      { lane: 2, duration: 1 },
    ],
  });
  const j = new Judgment([n, note(0.5, [3])]);
  j.strike(0, held(0, 2), true);
  j.strike(0.5, held(0, 2, 3), true);
  j.update(1, held(0));
  j.advance(2);
  assert.equal(j.hits, 2);
  assert.equal(j.score, 300);
  const equal = new Judgment([note(0, [0, 2], { duration: 2 })]);
  equal.strike(0, held(0, 2), true);
  equal.advance(2);
  assert.equal(equal.score, 200);
});
test("Star Power requires half meter, doubles score, overlaps phrase awards and drains over eight measures", () => {
  const ns = [
    note(1, [0], { phrase: 0 }),
    note(2, [1], { phrase: 1 }),
    note(3, [2], { phrase: 2 }),
    note(20, [3]),
  ];
  const j = new Judgment(ns);
  j.strike(1, held(0), true);
  assert.equal(j.activate(1), false);
  j.strike(2, held(1), true);
  assert.equal(j.activate(2), true);
  assert.equal(j.multiplier, 2);
  j.strike(3, held(2), true);
  assert.equal(j.score, 200);
  assert.equal(j.power, 0.6875);
  j.advance(13.99);
  assert.equal(j.powerActive, true);
  j.advance(14.01);
  assert.equal(j.powerActive, false);
});
test("missed Star Power phrases award nothing; whammy earns meter only on held phrase sustains", () => {
  const ns = [
    note(0, [0], { duration: 1, phrase: 0 }),
    note(2, [1], { phrase: 0 }),
  ];
  const j = new Judgment(ns);
  j.strike(0, held(0), true);
  j.update(0, held(0), true);
  j.advance(1);
  assert.ok(Math.abs(j.power - 2 / 30) < 1e-9);
  j.advance(2.2);
  assert.equal(j.power, 2 / 30);
  const ordinary = new Judgment([note(0, [0], { duration: 1 })]);
  ordinary.strike(0, held(0), true);
  ordinary.update(0, held(0), true);
  ordinary.advance(1);
  assert.equal(ordinary.power, 0);
});
test("Star Power and sustains are frame-rate independent, including depletion inside an update", () => {
  const ns = [note(0, [0], { duration: 15 })];
  const c = chart(ns, {
    tempos: [
      { time: 0, bpm: 120 },
      { time: 3, bpm: 180 },
    ],
    signatures: [
      { time: 0, numerator: 4, denominator: 4 },
      { time: 4, numerator: 3, denominator: 4 },
    ],
  });
  const run = (step: number) => {
    const j = new Judgment(ns, 0.14, c);
    j.power = 0.5;
    j.activate(0);
    j.strike(0, held(0), true);
    for (let t = step; t < 15; t += step) j.advance(t);
    j.advance(15);
    return j;
  };
  const a = run(15),
    b = run(1 / 144);
  assert.equal(a.score, b.score);
  assert.equal(a.powerActive, false);
  const timeline = new Timeline(c.tempos, c.signatures);
  assert.equal(timeline.position(5).beat, 12);
  assert.equal(timeline.timeAtMeasure(timeline.position(5).measure), 5);
});
test("solo bonuses follow hit percentage, round down to fifty and are awarded once", () => {
  const ns = Array.from({ length: 5 }, (_, i) => note(i + 1, [0], { solo: 0 }));
  const j = new Judgment(ns);
  for (let i = 0; i < 4; i++) j.strike(i + 1, held(0), true);
  j.advance(6);
  assert.equal(j.soloBonus, 200);
  assert.equal(j.score, 400);
  j.advance(7);
  assert.equal(j.soloBonus, 200);
});
test("MIDI retains forced/natural HOPOs, tap markers, phrases, solos and disjoint sustain lengths", () => {
  const m = new Midi();
  m.header.tempos = [{ ticks: 0, bpm: 120 }];
  m.header.update();
  const t = m.addTrack();
  t.name = "PART GUITAR";
  for (const [midi, ticks, durationTicks] of [
    [96, 0, 20],
    [97, 120, 20],
    [98, 480, 960],
    [100, 480, 480],
    [101, 480, 10],
    [99, 1600, 20],
    [104, 1600, 30],
    [116, 0, 1000],
    [103, 0, 1700],
  ])
    t.addNote({ midi, ticks, durationTicks });
  const c = parseMidi(m.toArray())[0];
  assert.deepEqual(
    c.notes.map((n: Note) => n.type),
    ["strum", "hopo", "hopo", "tap"],
  );
  assert.equal(c.notes[2].tails[0].duration, 1);
  assert.equal(c.notes[2].tails[1].duration, 0.5);
  assert.equal(c.notes[0].duration, 0);
  assert.equal(c.notes[2].phrase, 0);
  assert.equal(c.notes[3].solo, 0);
});

test("whammy overlap remains deterministic across frames and tempo changes", () => {
  const ns = [note(0, [0], { duration: 10, phrase: 0 })];
  const c = chart(ns, {
    tempos: [
      { time: 0, bpm: 120 },
      { time: 2, bpm: 60 },
    ],
  });
  const run = (step: number) => {
    const j = new Judgment(ns, 0.14, c);
    j.power = 0.5;
    j.activate(0);
    j.strike(0, held(0), true);
    j.update(0, held(0), true);
    for (let t = step; t < 10; t += step) j.advance(t);
    j.advance(10);
    return j;
  };
  const a = run(10),
    b = run(1 / 120);
  assert.equal(a.score, b.score);
  assert.ok(Math.abs(a.power - b.power) < 1e-8);
});

test("audio ending truncates sustains and marks remaining notes missed without awarding future time", () => {
  const j = new Judgment([note(0, [0], { duration: 20 }), note(10)]);
  j.strike(0, held(0), true);
  j.finish(1);
  assert.equal(j.score, 100);
  assert.equal(j.misses, 1);
  assert.equal(j.sustainActive(0, 0), false);
});
test("enhanced-open and Phase Shift tap/open MIDI markers survive normalization", () => {
  const { writeMidi } = require("midi-file");
  const events = [
    { deltaTime: 0, type: "trackName", text: "PART GUITAR" },
    { deltaTime: 0, type: "text", text: "[ENHANCED_OPENS]" },
    { deltaTime: 0, type: "noteOn", channel: 0, noteNumber: 95, velocity: 100 },
    { deltaTime: 20, type: "noteOff", channel: 0, noteNumber: 95, velocity: 0 },
    { deltaTime: 460, type: "sysEx", data: [0x50, 0x53, 0, 0, 3, 4, 1, 0xf7] },
    { deltaTime: 0, type: "sysEx", data: [0x50, 0x53, 0, 0, 3, 1, 1, 0xf7] },
    { deltaTime: 0, type: "noteOn", channel: 0, noteNumber: 96, velocity: 100 },
    { deltaTime: 20, type: "noteOff", channel: 0, noteNumber: 96, velocity: 0 },
    { deltaTime: 1, type: "sysEx", data: [0x50, 0x53, 0, 0, 3, 4, 0, 0xf7] },
    { deltaTime: 0, type: "sysEx", data: [0x50, 0x53, 0, 0, 3, 1, 0, 0xf7] },
    { deltaTime: 0, type: "endOfTrack" },
  ];
  const c = parseMidi(
    writeMidi({
      header: { format: 1, numTracks: 1, ticksPerBeat: 480 },
      tracks: [events],
    }),
  )[0];
  assert.equal(c.notes.length, 2);
  assert.equal(c.notes[0].open, true);
  assert.equal(c.notes[1].open, true);
  assert.equal(c.notes[1].type, "tap");
});

test("song.ini HOPO and sustain thresholds are chart ticks and honor legacy options", () => {
  const m = new Midi();
  const t = m.addTrack();
  t.name = "PART GUITAR";
  t.addNote({ midi: 96, ticks: 0, durationTicks: 150 });
  t.addNote({ midi: 97, ticks: 200, durationTicks: 160 });
  const bytes = m.toArray();
  const defaults = parseMidi(bytes)[0];
  assert.equal(defaults.notes[0].duration, 0);
  assert.ok(defaults.notes[1].duration > 0);
  assert.equal(defaults.notes[1].type, "strum");
  assert.equal(
    parseMidi(bytes, { eighthnote_hopo: "true" })[0].notes[1].type,
    "hopo",
  );
  assert.equal(parseMidi(bytes, { hopofreq: "3" })[0].notes[1].type, "hopo");
  const custom = parseMidi(bytes, {
    hopo_frequency: "199",
    sustain_cutoff_threshold: "0",
  })[0];
  assert.equal(custom.notes[1].type, "strum");
  assert.ok(custom.notes[0].duration > 0);
});
test("strummed sustains need the strum bar held when holdStrum is on", () => {
  const notes = [note(1, [0], { duration: 2 })];
  const score = (holdStrum: boolean, releaseStrumAt: number | null) => {
    const j = new Judgment(notes, 0.14, undefined, { holdStrum });
    j.strike(1, held(0), true);
    for (let t = 1.1; t <= 3.2; t += 0.1)
      j.update(
        t,
        held(0),
        false,
        true,
        releaseStrumAt === null || t < releaseStrumAt,
      );
    return j;
  };
  const full = score(true, null);
  const dropped = score(true, 1.5);
  const classic = score(false, 1.5);
  assert.equal(full.sustained, 1, "held to the end");
  assert.equal(dropped.sustained, 0, "strum let go early");
  assert.ok(dropped.score < full.score, "the tail stops scoring");
  assert.equal(classic.score, full.score, "without the rule, frets suffice");
  assert.equal(classic.sustained, 1);
  // A short release (under the grace) still counts as held.
  const blip = new Judgment(notes, 0.14, undefined, { holdStrum: true });
  blip.strike(1, held(0), true);
  blip.update(1.5, held(0), false, true, false);
  blip.update(1.53, held(0), false, true, true);
  blip.update(3.2, held(0), false, true, true);
  assert.equal(blip.sustained, 1);
});
test("tap and HOPO sustains hit by fretting need only the frets", () => {
  const j = new Judgment(
    [note(1, [0]), note(1.2, [1], { type: "hopo", duration: 1.5 })],
    0.14,
    undefined,
    { holdStrum: true },
  );
  j.strike(1, held(0), true);
  j.update(1.05, held(0), false, true, false);
  j.fret(1.2, held(1));
  for (let t = 1.3; t <= 3; t += 0.1) j.update(t, held(1), false, true, false);
  assert.equal(j.sustained, 1);
});
test("perfect hits and chords are counted for celebrations", () => {
  const j = new Judgment([note(1, [0]), note(2, [0, 1]), note(3, [2])]);
  j.strike(1, held(0), true);
  j.strike(2.1, held(0, 1), true);
  j.strike(3.01, held(2), true);
  assert.equal(j.perfects, 2);
  assert.equal(j.chords, 1);
});
