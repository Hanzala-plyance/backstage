import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url);
const { PreparationService } = require("../electron/service.cjs");
const { Library } = require("../electron/library.cjs");
const temp = await mkdtemp(path.join(os.tmpdir(), "backstage-service-test-"));
const root = path.resolve("..");
const service = new PreparationService({
  source: path.join(root, "song-converter"),
  data: path.join(temp, "data"),
  python: process.env.BACKSTAGE_PYTHON || path.join(root, ".venv/bin/python"),
  songsRoot: path.join(temp, "songs"),
});
try {
  await service.ensure();
  console.log(
    "PASS: lazy converter starts with isolated writable output/cache/library.",
  );
  if (process.env.BACKSTAGE_TEST_ONLINE === "1") {
    for (const provider of ["youtube", "charts"]) {
      try {
        const results = await service.request(
          `/api/${provider}/search?q=${encodeURIComponent("Kevin MacLeod")}`,
        );
        console.log(`Online ${provider}: ${results.results.length} results`);
      } catch (e) {
        console.log(`Online ${provider}: ${e.message}`);
      }
    }
  }
  const rate = 22050,
    length = rate * 8,
    buffer = Buffer.alloc(44 + length * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + length * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    const t = i / rate,
      beat = t % 0.5;
    buffer.writeInt16LE(
      Math.round(
        16000 * Math.sin(2 * Math.PI * 220 * t) * Math.exp(-beat * 12),
      ),
      44 + i * 2,
    );
  }
  const form = new FormData();
  form.set("audio", new Blob([buffer]), "Backstage synthetic test.wav");
  form.set("lyrics_mode", "skip");
  form.set("art_mode", "offline");
  form.set("title", "Desktop integration soundcheck");
  const { id } = await service.request("/api/jobs", {
    method: "POST",
    body: form,
  });
  let result;
  for (let i = 0; i < 180; i++) {
    result = await service.request(`/api/jobs/${id}`);
    if (result.status === "complete" || result.status === "error") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (result.status !== "complete" || result.library?.status !== "installed")
    throw Error(JSON.stringify(result));
  const library = new Library(service.songsRoot);
  const scanned = await library.scan();
  const song = scanned.songs.find((s) => s.id !== "practice");
  if (!song) throw Error("Converted song missing from desktop library.");
  const loaded = library.load(song.id, "Guitar", "Expert");
  if (!loaded.chart.notes.length) throw Error("No playable chart.");
  console.log(
    "PASS: real upload → conversion → installed shared library → desktop MIDI load; " +
      loaded.chart.notes.length +
      " expert chords.",
  );
} finally {
  service.stop();
  await new Promise((r) => setTimeout(r, 1000));
  await rm(temp, { recursive: true, force: true });
}
