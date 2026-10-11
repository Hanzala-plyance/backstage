import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Scores } = require("../electron/scores.cjs");
const id = "a".repeat(32);
const result = (score: number, extra = {}) => ({
  id,
  part: "Guitar",
  level: "Expert",
  score,
  stars: 3,
  accuracy: 90,
  maxCombo: 40,
  ...extra,
});
test("only a higher score replaces the saved best", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "backstage-scores-"));
  try {
    const scores = new Scores(path.join(dir, "scores.json"));
    assert.equal(scores.record(result(1000)).best, true);
    assert.equal(scores.record(result(900)).best, false);
    assert.equal(
      scores.record(result(1000)).best,
      false,
      "ties keep the first",
    );
    const better = scores.record(result(1500, { stars: 4 }));
    assert.equal(better.best, true);
    assert.equal(better.previous.score, 1000);
    const saved = scores.all()[`${id}|Guitar|Expert`];
    assert.equal(saved.score, 1500);
    assert.equal(saved.stars, 4);
    // Other charts are tracked separately.
    assert.equal(scores.record(result(10, { level: "Easy" })).best, true);
    assert.equal(Object.keys(scores.all()).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("invalid results are refused and a corrupt file reads as empty", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "backstage-scores-"));
  try {
    const file = path.join(dir, "scores.json");
    const scores = new Scores(file);
    for (const bad of [
      result(-1),
      result(1.5),
      result(10, { stars: 7 }),
      result(10, { part: "Vocals" }),
      result(10, { id: "../../etc" }),
      result(10, { accuracy: 101 }),
    ])
      assert.throws(() => scores.record(bad), /Invalid score/);
    await writeFile(file, "{not json");
    assert.deepEqual(scores.all(), {});
    assert.equal(scores.record(result(5)).best, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
