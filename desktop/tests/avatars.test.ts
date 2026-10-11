import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  cleanName,
  drumKits,
  gearOf,
  guitarStyles,
  handZones,
  moodFor,
  motion,
  presets,
  slotName,
  stylize,
} from "../src/core/avatars";
const require = createRequire(import.meta.url);
const { Band, PRESETS, GUITARS, KITS } = require("../electron/band.cjs");
test("names keep up to 8 capital letters and digits", () => {
  assert.equal(cleanName("shredder99"), "SHREDDER");
  assert.equal(cleanName("  dj-k!d 7 "), "DJKD7");
  assert.equal(
    slotName(1, { name: "", look: { kind: "preset", id: "volt" } }),
    "P2",
  );
  assert.equal(
    slotName(0, { name: "ACE", look: { kind: "preset", id: "volt" } }),
    "ACE",
  );
});
test("31 distinct premade avatars, matching the store", () => {
  assert.equal(presets.length, 31);
  assert.equal(new Set(presets.map((p) => p.id)).size, 31);
  assert.equal(presets.filter((p) => p.build === "slim").length, 9);
  assert.deepEqual(
    presets.map((p) => p.id),
    PRESETS,
  );
  assert.ok(new Set(presets.map((p) => p.style)).size >= 20, "varied hair");
});
test("photos are restyled onto the stage palette with contrast stretch", () => {
  // A dim gradient still spans the palette after stretching.
  const pixels = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i++) {
    pixels.set([60 + i, 60 + i, 60 + i, 255], i * 4);
  }
  const out = stylize(pixels);
  assert.deepEqual([...out.slice(0, 3)], [11, 7, 20]);
  assert.deepEqual([...out.slice(99 * 4, 99 * 4 + 3)], [210, 250, 255]);
  assert.equal(out[3], 255);
  assert.equal(pixels[0], 60, "input unchanged");
});
test("raised-hand motion is measured in the upper corners only", () => {
  const w = 10,
    h = 10;
  const still = new Uint8ClampedArray(w * h * 4);
  const moved = new Uint8ClampedArray(still);
  // Movement in the top-left corner (a hand) and the centre (the face).
  for (const [x, y] of [
    [0, 0],
    [1, 1],
    [2, 2],
    [5, 5],
    [5, 6],
  ])
    moved.set([255, 255, 255, 255], (y * w + x) * 4);
  assert.ok(motion(still, moved, w, h, handZones[0]) > 0.1);
  assert.equal(motion(still, moved, w, h, handZones[1]), 0);
});
test("moods follow Star Power, misses and streaks", () => {
  assert.equal(
    moodFor({ powerActive: true, combo: 0, missedRecently: true }),
    "power",
  );
  assert.equal(
    moodFor({ powerActive: false, combo: 30, missedRecently: true }),
    "miss",
  );
  assert.equal(
    moodFor({ powerActive: false, combo: 12, missedRecently: false }),
    "hyped",
  );
  assert.equal(
    moodFor({ powerActive: false, combo: 30, missedRecently: false }),
    "shred",
  );
  assert.equal(
    moodFor({ powerActive: false, combo: 3, missedRecently: false }),
    "groove",
  );
});
test("band store validates names, avatars and slots", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "backstage-band-"));
  try {
    const file = path.join(dir, "band.json");
    const band = new Band(file);
    assert.deepEqual(band.all()[2], {
      name: "",
      look: { kind: "preset", id: "nova" },
    });
    band.save(0, { name: "shredder99", look: { kind: "preset", id: "jinx" } });
    assert.deepEqual(band.all()[0], {
      name: "SHREDDER",
      look: { kind: "preset", id: "jinx" },
    });
    const photo = "data:image/png;base64,iVBORw0KGgo=";
    band.save(1, { name: "ace", look: { kind: "photo", image: photo } });
    assert.equal(band.all()[1].look.image, photo);
    assert.throws(() =>
      band.save(4, { name: "", look: { kind: "preset", id: "volt" } }),
    );
    assert.throws(() =>
      band.save(0, { name: "", look: { kind: "preset", id: "nope" } }),
    );
    assert.throws(() =>
      band.save(0, {
        name: "",
        look: { kind: "photo", image: "https://example.com/a.png" },
      }),
    );
    assert.throws(() =>
      band.save(0, {
        name: "",
        look: { kind: "photo", image: photo + "A".repeat(500 * 1024) },
      }),
    );
    // A corrupt file falls back to defaults rather than failing.
    await writeFile(file, "{not json");
    assert.equal(band.all()[0].look.id, "volt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("gear choices match the store and fill in defaults", async () => {
  assert.deepEqual(
    guitarStyles.map((g) => g.id),
    GUITARS,
  );
  assert.deepEqual(
    drumKits.map((k) => k.id),
    KITS,
  );
  assert.equal(
    gearOf(0, {
      name: "",
      look: { kind: "preset", id: "volt" },
      gear: { guitar: "arrow" } as never,
    }).guitar,
    "arrow",
  );
  assert.equal(gearOf(1).side, "left");
  const dir = await mkdtemp(path.join(os.tmpdir(), "backstage-gear-"));
  try {
    const band = new Band(path.join(dir, "band.json"));
    band.save(0, {
      name: "a",
      look: { kind: "preset", id: "volt" },
      gear: {
        guitar: "single-cut",
        finish: "#FF2E88",
        kit: "nope",
        side: "left",
        extra: 1,
      },
    });
    assert.deepEqual(band.all()[0].gear, {
      guitar: "single-cut",
      finish: "#ff2e88",
      side: "left",
    });
    assert.equal(band.all()[1].gear, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
