import { test } from "node:test";
import assert from "node:assert/strict";
import { SongGain } from "../src/core/feedback";
test("song gain dips on misses and rises on perfects, within bounds", () => {
  const g = new SongGain();
  g.miss();
  assert.ok(Math.abs(g.target - 0.97) < 1e-9, "3% quieter");
  for (let i = 0; i < 50; i++) g.miss();
  assert.equal(g.target, SongGain.MIN, "never below 82%");
  for (let i = 0; i < 50; i++) g.perfect();
  assert.equal(g.target, SongGain.MAX, "never above 105%");
  // The element volume eases toward the target and never exceeds 1.
  let v = 0;
  for (let i = 0; i < 60; i++) v = g.step(1 / 60, 1);
  assert.equal(v, 1, "capped at full device volume");
  g.reset();
  g.miss(2);
  const first = g.step(1 / 60, 0.5);
  assert.ok(first < 0.5 && first > 0.5 * 0.94, "eases, doesn't jump");
  for (let i = 0; i < 120; i++) v = g.step(1 / 60, 0.5);
  assert.ok(Math.abs(v - 0.5 * 0.94) < 1e-3);
});
