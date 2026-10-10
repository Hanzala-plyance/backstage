import { test } from "node:test";
import assert from "node:assert/strict";
import { Judgment } from "../src/core/judgment";
import {
  DemoPlayer,
  checkItems,
  keyItem,
  padActive,
  applyDemo,
  cueFor,
  lessonChart,
  lessonEnd,
  lessonResult,
  lessons,
} from "../src/core/lessons";
const idle = [false, false, false, false, false];
// Runs a lesson at 60 fps with the demo player, or with no input at all.
function run(
  lesson: (typeof lessons)[number],
  strumMode: boolean,
  demo = true,
) {
  const chart = lessonChart(lesson);
  const judge = new Judgment(chart.notes, 0.14, chart);
  const player = new DemoPlayer(
    chart.notes,
    strumMode,
    lesson.goal.kind === "power",
  );
  let held = idle,
    usedPower = false;
  const end = lessonEnd(lesson);
  for (let t = 0; t < end; t += 1 / 60) {
    if (demo) held = applyDemo(judge, t, held, player.input(t), strumMode);
    else judge.update(t, idle);
    usedPower ||= judge.powerActive;
  }
  judge.finish(end);
  return lessonResult(lesson, {
    hits: judge.hits,
    score: judge.score,
    maxCombo: judge.maxCombo,
    usedPower,
  });
}
test("every lesson fits the practice backing", () => {
  for (const lesson of lessons) {
    assert.ok(lessonEnd(lesson) < 31, lesson.id);
    assert.ok(
      lesson.notes.every((n, i, all) => !i || n.time > all[i - 1].time),
    );
  }
});
for (const strumMode of [true, false])
  test(`each demo passes its own goal (${strumMode ? "strum" : "tap"} mode)`, () => {
    for (const lesson of lessons) {
      const result = run(lesson, strumMode);
      assert.ok(result.passed, `${lesson.id}: ${result.value}`);
    }
  });
test("doing nothing passes no lesson", () => {
  for (const lesson of lessons)
    assert.equal(run(lesson, true, false).passed, false, lesson.id);
});
test("sustain lesson needs the tails held", () => {
  const lesson = lessons.find((l) => l.goal.kind === "sustain")!;
  const chart = lessonChart(lesson);
  const judge = new Judgment(chart.notes, 0.14, chart);
  for (const n of chart.notes) {
    const lanes = idle.map((_, l) => n.lanes.includes(l));
    judge.strike(n.time, lanes, true);
    judge.update(n.time + 0.05, idle); // let go straight away
  }
  judge.finish(lessonEnd(lesson));
  const result = lessonResult(lesson, {
    hits: judge.hits,
    score: judge.score,
    maxCombo: judge.maxCombo,
    usedPower: false,
  });
  assert.equal(judge.hits, chart.notes.length);
  assert.equal(result.passed, false);
});
test("cues name frets and the action", () => {
  assert.equal(
    cueFor({ time: 0, duration: 0, lanes: [0, 1] }, true),
    "Green + Red · Strum",
  );
  assert.equal(
    cueFor({ time: 0, duration: 1, lanes: [4], type: "hopo" }, true),
    "Orange · Hammer on and hold",
  );
});
test("controller check covers every input a player needs", () => {
  const pad = checkItems(true).map((i) => i.id);
  assert.deepEqual(pad, [
    "lane0",
    "lane1",
    "lane2",
    "lane3",
    "lane4",
    "strumUp",
    "strumDown",
    "starPower",
    "whammy",
    "pause",
  ]);
  // Every keyboard item has a key that marks it.
  const codes = [
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyF",
    "KeyG",
    "Space",
    "ShiftLeft",
    "KeyW",
  ];
  assert.deepEqual(
    checkItems(false).map((i) => i.id),
    codes.map(keyItem),
  );
  assert.equal(keyItem("KeyQ"), null);
  assert.deepEqual(
    padActive({
      lanes: [true, false, false, false, true],
      strumUp: false,
      strumDown: true,
      starPower: false,
      whammy: true,
      pause: false,
    }),
    ["lane0", "lane4", "strumDown", "whammy"],
  );
});
