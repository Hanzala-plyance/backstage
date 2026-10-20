import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYPAD, tapKey, type LastTap } from "../src/core/namepad";
const press = (name: string, keys: [number, number][]) => {
  let last: LastTap = null;
  for (const [key, at] of keys) ({ name, last } = tapKey(name, key, last, at));
  return name;
};
test("multi-tap cycles a key's letters, then wraps", () => {
  assert.equal(press("", [[1, 0]]), "A");
  assert.equal(
    press("", [
      [1, 0],
      [1, 300],
    ]),
    "B",
  );
  assert.equal(
    press("", [
      [1, 0],
      [1, 300],
      [1, 600],
    ]),
    "C",
  );
  assert.equal(press("", [[0, 0]]), "1", "the 123 key types digits");
  assert.equal(
    press("", [
      [1, 0],
      [1, 300],
      [1, 600],
      [1, 900],
    ]),
    "A",
  );
});
test("a pause or another key starts a new letter", () => {
  assert.equal(
    press("", [
      [1, 0],
      [1, 1500],
    ]),
    "AA",
    "after a second",
  );
  assert.equal(
    press("", [
      [7, 0],
      [2, 100],
      [4, 200],
    ]),
    "TDJ",
  );
});
test("delete, OK and the 8-character limit", () => {
  const back = KEYPAD.findIndex((k) => k.label === "←");
  const ok = KEYPAD.findIndex((k) => k.label === "OK");
  assert.equal(tapKey("ACE", back, null, 0).name, "AC");
  assert.equal(tapKey("ACE", ok, null, 0).done, true);
  assert.equal(tapKey("ABCDEFGH", 1, null, 0).name, "ABCDEFGH");
  // Cycling the last letter still works at the limit.
  assert.equal(tapKey("ABCDEFGA", 1, { key: 1, at: 0 }, 200).name, "ABCDEFGB");
});
