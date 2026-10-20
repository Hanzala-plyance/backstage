import { test } from "node:test";
import assert from "node:assert/strict";
import { countLabel, runFrom } from "../src/core/countin";

test("a fresh start counts in for three seconds before the audio", () => {
  assert.deepEqual(runFrom(null, 0), { audioAt: 0, lead: 3, guard: 0 });
  // A positive audio offset shortens the silent lead, same song clock.
  assert.deepEqual(runFrom(null, 0.5), { audioAt: 0, lead: 2.5, guard: 0 });
});

test("resuming rewinds two seconds and judges from the pause point", () => {
  assert.deepEqual(runFrom(42, 0), { audioAt: 40, lead: 0, guard: 42 });
  assert.deepEqual(runFrom(42, 0.1).audioAt.toFixed(2), "40.10");
});

test("resuming near the start leads in instead of seeking before zero", () => {
  assert.deepEqual(runFrom(0.5, 0), { audioAt: 0, lead: 1.5, guard: 0.5 });
  // Paused during the count-in itself.
  assert.deepEqual(runFrom(-1, 0), { audioAt: 0, lead: 3, guard: -1 });
});

test("the count shows whole seconds to the guard, then GO", () => {
  assert.equal(countLabel(-3, 0), "3");
  assert.equal(countLabel(-2.01, 0), "3");
  assert.equal(countLabel(-2, 0), "2");
  assert.equal(countLabel(-0.2, 0), "1");
  assert.equal(countLabel(0.1, 0), "GO!");
  assert.equal(countLabel(0.6, 0), null);
  assert.equal(countLabel(40, 42), "2");
});
