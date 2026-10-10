import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Judgment } from "../src/core/judgment";
import {
  readPad,
  defaultProfile,
  newlyPressed,
  validProfile,
} from "../src/core/input";
const require = createRequire(import.meta.url);
const { Library, parseMidi, ini } = require("../electron/library.cjs");
const { validVideo } = require("../electron/service.cjs");
const { Midi } = require("@tonejs/midi");
test("judgment uses timestamps, tolerates boundaries, scores once and expires missed notes", () => {
  const j = new Judgment([
    { time: 1, duration: 0, lanes: [0, 2] },
    { time: 2, duration: 0, lanes: [1] },
  ]);
  assert.equal(j.strike(0.9, [true, false, false, false, false], true), null);
  assert.equal(
    j.strike(1.01, [true, false, true, false, false], true),
    "perfect",
  );
  assert.equal(j.strike(1.02, [true, false, true, false, false], true), null);
  j.advance(2.2);
  assert.equal(j.score, 100);
  assert.equal(j.hits, 1);
  assert.equal(j.misses, 1);
  assert.equal(j.accuracy, 50);
});
test("higher frets reject a strum and future notes cannot be skipped", () => {
  const j = new Judgment([{ time: 1, duration: 0, lanes: [1] }]);
  assert.equal(j.strike(1, [false, true, true, false, false], true), null);
  assert.equal(
    j.strike(1, [false, true, false, false, false], true),
    "perfect",
  );
});
test("button and signed axis mappings normalize without drift and clear on disconnect", () => {
  const profile = defaultProfile();
  profile.bindings.strumDown = { type: "axis", index: 1, direction: -1 };
  const pad = {
    connected: true,
    buttons: [{ pressed: true }],
    axes: [0, -0.8],
  } as unknown as Gamepad;
  assert.equal(readPad(pad, profile).strum, true);
  assert.equal(readPad(pad, profile).lanes[0], true);
  assert.deepEqual(readPad(null, profile).lanes, [
    false,
    false,
    false,
    false,
    false,
  ]);
  assert.equal(readPad({ ...pad, axes: [0, -0.2] }, profile).strum, false);
});
test("mapping listens for a new edge rather than an already-held button", () => {
  const pad = { buttons: [{ pressed: true }], axes: [0] } as unknown as Gamepad;
  assert.equal(newlyPressed(pad, pad), null);
  assert.deepEqual(newlyPressed(pad, { buttons: [], axes: [] }), {
    type: "button",
    index: 0,
  });
  const p = defaultProfile();
  p.bindings.pause.index = -1;
  assert.equal(validProfile(p), false);
});
function fixture() {
  const midi = new Midi();
  midi.header.tempos = [
    { ticks: 0, bpm: 120 },
    { ticks: 480, bpm: 60 },
  ];
  midi.header.update();
  midi.addTrack().name = "META";
  const track = midi.addTrack();
  track.name = "PART GUITAR";
  track.addNote({ midi: 96, ticks: 0, durationTicks: 120 });
  track.addNote({ midi: 98, ticks: 960, durationTicks: 120 });
  return midi.toArray();
}
test("MIDI parsing respects tempo changes and difficulty ranges", () => {
  const charts = parseMidi(fixture());
  assert.equal(charts.length, 1);
  assert.equal(charts[0].level, "Expert");
  assert.ok(Math.abs(charts[0].notes[1].time - 1.5) < 0.001);
  assert.deepEqual(charts[0].notes[1].lanes, [2]);
});
test("library loads valid MIDI, rejects linked files and does not expose paths in song payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "backstage-library-"));
  try {
    const song = path.join(root, "song");
    await mkdir(song);
    await writeFile(
      path.join(song, "song.ini"),
      "[song]\nname = Fixture\nartist = Test",
    );
    await writeFile(path.join(song, "notes.mid"), fixture());
    await writeFile(path.join(song, "song.ogg"), "fixture");
    const library = new Library(root);
    const result = await library.scan();
    assert.equal(result.songs.length, 2);
    const id = result.songs[1].id;
    assert.equal(library.load(id, "Guitar", "Expert").chart.notes.length, 2);
    assert.ok(!JSON.stringify(result.songs).includes(root));
    await rm(path.join(song, "song.ogg"));
    await symlink(path.join(root, "outside"), path.join(song, "song.ogg"));
    const second = await library.scan();
    assert.equal(second.songs.length, 1);
    assert.equal(second.warnings.length, 1);
    assert.throws(() => library.load(id, "Guitar", "Expert"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("library metadata ignores unrelated ini sections and strips BOM", () => {
  assert.deepEqual(ini("\uFEFF[song]\nname=One\n[other]\nname=Two"), {
    name: "One",
  });
});
test("only individual YouTube videos can enter preparation IPC", () => {
  assert.equal(
    validVideo("https://youtu.be/jNQXAC9IVRw"),
    "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  );
  for (const url of [
    "file:///etc/passwd",
    "https://example.com/watch?v=jNQXAC9IVRw",
    "https://youtube.com.evil.test/watch?v=jNQXAC9IVRw",
    "javascript:alert(1)",
    "https://youtube.com/playlist?list=abc",
  ])
    assert.throws(() => validVideo(url));
});

test("queue history survives restart and reports interrupted/missing installations without launching Python", async () => {
  const { PreparationService } = require("../electron/service.cjs");
  const temp = await mkdtemp(path.join(os.tmpdir(), "backstage-history-"));
  try {
    const id = "a".repeat(32),
      folder = path.join(temp, "output", id);
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, "job.json"),
      JSON.stringify({ id, title: "Test", created_at: 1 }),
    );
    const service = new PreparationService({
      source: "",
      data: temp,
      python: "",
      songsRoot: temp,
    });
    assert.equal(service.history()[0].status, "error");
    assert.equal(service.child, null);
    await writeFile(path.join(folder, "result.json"), "{}");
    await writeFile(
      path.join(folder, "library.json"),
      JSON.stringify({ status: "installed", path: path.join(temp, "missing") }),
    );
    assert.equal(service.history()[0].library.status, "missing");
    assert.equal(service.child, null);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
