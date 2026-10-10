import { test } from "node:test";
import assert from "node:assert/strict";
import { Judgment } from "../src/core/judgment";
import { baseScore, starsFor } from "../src/core/stars";
const chart = (count: number, duration = 0) => ({
  tempos: [{ time: 0, bpm: 120 }],
  signatures: [{ time: 0, numerator: 4, denominator: 4 }],
  notes: Array.from({ length: count }, (_, i) => ({
    time: 1 + i,
    duration,
    lanes: [i % 5],
  })),
});
const play = (c: ReturnType<typeof chart>, hit: (i: number) => boolean) => {
  const j = new Judgment(c.notes as any, 0.14, c as any);
  c.notes.forEach((n, i) => {
    const lanes = [0, 1, 2, 3, 4].map((l) => n.lanes.includes(l));
    if (hit(i)) j.strike(n.time, lanes, true);
    j.update(n.time + n.duration + 0.01, [false, false, false, false, false]);
  });
  j.finish(c.notes.length + 5);
  return j.score;
};
test("base score is 50 per gem plus 25 per sustained beat", () => {
  assert.equal(baseScore(chart(10)), 500);
  // 0.5 s at 120 bpm is one beat per note.
  assert.equal(baseScore(chart(4, 0.5)), 4 * 50 + 4 * 25);
  assert.equal(
    baseScore({
      ...chart(1),
      notes: [{ time: 1, duration: 0, lanes: [0, 1, 2] }],
    }),
    150,
  );
});
test("a full combo of 40 notes earns four stars; partial play earns fewer", () => {
  const c = chart(40);
  const base = baseScore(c);
  const full = play(c, () => true);
  // The note that completes a streak of 10 already scores at the new multiplier.
  assert.equal(full, 9 * 50 + 10 * 100 + 10 * 150 + 11 * 200);
  assert.equal(starsFor(full, base, "Guitar"), 4);
  assert.equal(
    starsFor(
      play(c, (i) => i % 2 === 0),
      base,
      "Guitar",
    ),
    2,
  );
  assert.equal(starsFor(0, base, "Guitar"), 0);
});
test("threshold boundaries and gold stars", () => {
  assert.equal(starsFor(0.21 * 1000, 1000, "Guitar"), 1);
  assert.equal(starsFor(0.2099 * 1000, 1000, "Guitar"), 0);
  assert.equal(starsFor(4.52 * 1000, 1000, "Guitar"), 6);
  assert.equal(starsFor(4.3 * 1000, 1000, "Drums"), 6);
  assert.equal(starsFor(4.3 * 1000, 1000, "Bass"), 5);
  assert.equal(starsFor(100, 0, "Guitar"), 0);
});
