import { test } from "node:test";
import assert from "node:assert/strict";
import { MenuPad } from "../src/core/menu";
import { defaultProfile } from "../src/core/input";
import { Timeline } from "../src/core/timeline";
const pad = (pressed: number[] = [], connected = true) =>
  ({
    index: 0,
    id: "Test guitar",
    connected,
    buttons: Array.from({ length: 16 }, (_, i) => ({
      pressed: pressed.includes(i),
      touched: false,
      value: pressed.includes(i) ? 1 : 0,
    })),
    axes: [0, 0],
  }) as unknown as Gamepad;
const profile = defaultProfile();
test("menu ignores buttons already held when a pad is first seen", () => {
  const menu = new MenuPad();
  assert.deepEqual(
    menu.poll(0, [pad([0])], () => profile),
    [],
  );
  assert.deepEqual(
    menu.poll(16, [pad([0])], () => profile),
    [],
  );
  assert.deepEqual(
    menu.poll(32, [pad([])], () => profile),
    [],
  );
  assert.deepEqual(
    menu.poll(48, [pad([0])], () => profile),
    ["green"],
  );
});
test("menu maps frets, strum and start using the pad profile", () => {
  const menu = new MenuPad();
  menu.poll(0, [pad()], () => profile);
  assert.deepEqual(
    menu.poll(10, [pad([1, 13, 9])], () => profile),
    ["red", "down", "start"],
  );
  const remapped = {
    ...profile,
    bindings: {
      ...profile.bindings,
      lane2: { type: "button" as const, index: 7 },
    },
  };
  assert.deepEqual(
    menu.poll(20, [pad([7])], () => remapped),
    ["yellow"],
  );
});
test("held strum repeats after a delay", () => {
  const menu = new MenuPad();
  menu.poll(0, [pad()], () => profile);
  assert.deepEqual(
    menu.poll(10, [pad([12])], () => profile),
    ["up"],
  );
  assert.deepEqual(
    menu.poll(200, [pad([12])], () => profile),
    [],
  );
  assert.deepEqual(
    menu.poll(400, [pad([12])], () => profile),
    ["up"],
  );
  assert.deepEqual(
    menu.poll(450, [pad([12])], () => profile),
    [],
  );
  assert.deepEqual(
    menu.poll(520, [pad([12])], () => profile),
    ["up"],
  );
});
test("a reconnected pad is seeded again", () => {
  const menu = new MenuPad();
  menu.poll(0, [pad()], () => profile);
  menu.poll(10, [], () => profile);
  assert.deepEqual(
    menu.poll(20, [pad([0])], () => profile),
    [],
  );
});
test("beat grid follows tempo changes and marks bar lines", () => {
  const t = new Timeline(
    [
      { time: 0, bpm: 120 },
      { time: 2, bpm: 60 },
    ],
    [{ time: 0, numerator: 4, denominator: 4 }],
  );
  const grid = t.beatGrid(4);
  assert.deepEqual(
    grid.map((b) => b.time),
    [0, 0.5, 1, 1.5, 2, 3, 4],
  );
  assert.deepEqual(
    grid.map((b) => b.downbeat),
    [true, false, false, false, true, false, false],
  );
});
