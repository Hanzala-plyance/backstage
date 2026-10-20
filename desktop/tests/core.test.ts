import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  realpath,
} from "node:fs/promises";
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
test("removing a song trashes only its scanned folder inside the library", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "backstage-remove-"));
  try {
    const make = async (name: string, extra = "") => {
      const dir = path.join(root, name);
      await mkdir(dir);
      await writeFile(
        path.join(dir, "song.ini"),
        `[song]\nname = ${name}\nartist = Test${extra}`,
      );
      await writeFile(path.join(dir, "notes.mid"), fixture());
      await writeFile(path.join(dir, "song.ogg"), "fixture");
      return dir;
    };
    const keep = await make("Keep", "\npreview_start_time = 300");
    const gone = await make("Gone");
    const goneReal = await realpath(gone);
    const library = new Library(root);
    const { songs } = await library.scan();
    const byTitle = (t: string) => songs.find((x: any) => x.title === t);
    assert.equal(
      byTitle("Keep").preview,
      0.3,
      "authored preview start is used",
    );
    assert.ok(
      Math.abs(byTitle("Gone").preview - byTitle("Gone").duration / 3) < 1e-9,
      "songs without one preview a third of the way in",
    );
    const trashed: string[] = [];
    const trash = async (dir: string) => {
      trashed.push(dir);
      await rm(dir, { recursive: true });
    };
    await assert.rejects(library.remove("practice", trash), /practice/);
    // A trash failure leaves the song in the library.
    await assert.rejects(
      library.remove(byTitle("Gone").id, async () => {
        throw Error("no trash");
      }),
      /no trash/,
    );
    assert.equal(
      (await library.remove(byTitle("Gone").id, trash)).title,
      "Gone",
    );
    assert.deepEqual(trashed, [goneReal]);
    assert.throws(() => library.load(byTitle("Gone").id, "Guitar", "Expert"));
    // A folder swapped for a link after scanning is refused.
    await rm(keep, { recursive: true });
    await mkdir(path.join(root, "elsewhere"));
    await symlink(path.join(root, "elsewhere"), keep);
    await assert.rejects(library.remove(byTitle("Keep").id, trash), /changed/);
    assert.equal(trashed.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("job-ID folders get readable names; named folders and clashes are safe", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "backstage-names-"));
  try {
    const make = async (
      folder: string,
      name: string,
      artist: string,
      art = false,
    ) => {
      const dir = path.join(root, folder);
      await mkdir(dir);
      await writeFile(
        path.join(dir, "song.ini"),
        `[song]\nname = ${name}\nartist = ${artist}`,
      );
      await writeFile(path.join(dir, "notes.mid"), fixture());
      await writeFile(path.join(dir, "song.ogg"), "fixture");
      if (art) await writeFile(path.join(dir, "album.png"), "placeholder");
    };
    await make(
      "a".repeat(32),
      "Daft Punk - One More Time (Official Video)",
      "Daft Punk",
      true,
    );
    await make("b".repeat(32), "Drake - Janice STFU", "Drake");
    await make("Drake - Janice STFU", "Something else", "Me"); // clash, user-named
    await make("My Mix", "Mine", "Me");
    const library = new Library(root);
    const { songs } = await library.scan();
    const daft = songs.find((s: any) => s.title === "One More Time");
    assert.equal(daft.artist, "Daft Punk", "display names are cleaned");
    assert.ok(daft.art > 0);
    await writeFile(
      path.join(root, "b".repeat(32), ".backstage.json"),
      JSON.stringify({ job_id: "b".repeat(32) }),
    );
    const before = (await library.scan()).songs.find(
      (s: any) => s.title === "Janice STFU",
    ).id;
    assert.equal(before, "b".repeat(32), "converter songs keep their job ID");
    assert.equal(await library.renameFolders(), 2);
    assert.ok(
      (await library.scan()).songs.some((s: any) => s.id === before),
      "renaming keeps the song's identity",
    );
    const { readdir } = await import("node:fs/promises");
    assert.deepEqual((await readdir(root)).sort(), [
      "Daft Punk - One More Time",
      "Drake - Janice STFU",
      "Drake - Janice STFU (2)",
      "My Mix",
    ]);
    const { readFile } = await import("node:fs/promises");
    assert.match(
      await readFile(
        path.join(root, "Drake - Janice STFU", "song.ini"),
        "utf8",
      ),
      /Something else/,
      "existing folder untouched",
    );
    // Covers: only missing or placeholder art is targeted; saving is atomic.
    const rescanned = (await library.scan()).songs;
    const targets = library.coverTargets((file: string) =>
      file.endsWith("album.png"),
    );
    assert.equal(
      targets.length,
      rescanned.length - 1,
      "all but practice need covers",
    );
    const none = library.coverTargets(() => false);
    assert.equal(none.length, rescanned.length - 2, "real art is kept");
    const janice = rescanned.find((s: any) => s.title === "Janice STFU");
    await library.saveCover(janice.id, Buffer.from("png"));
    assert.equal(
      await readFile(
        path.join(root, "Drake - Janice STFU (2)", "album.png"),
        "utf8",
      ),
      "png",
    );
    await assert.rejects(
      library.art(janice.id),
      /No cover/,
      "stale scan has no art yet",
    );
    await library.scan();
    const fresh = library.coverTargets(() => false);
    assert.ok(!fresh.some((t: any) => t.title === "Janice STFU"));
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
