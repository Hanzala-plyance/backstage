const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseMidi } = require("./chart.cjs");
function ini(text) {
  const result = {};
  let song = false;
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const s = line.trim();
    if (s.startsWith("[")) {
      song = s.toLowerCase() === "[song]";
      continue;
    }
    if (!song || s.startsWith(";") || s.startsWith("#")) continue;
    const at = s.indexOf("=");
    if (at > 0)
      result[s.slice(0, at).trim().toLowerCase()] = s.slice(at + 1).trim();
  }
  return result;
}
const practice = {
  id: "practice",
  title: "Soundcheck",
  artist: "Backstage Sessions",
  duration: 32,
  preview: 2,
  practice: true,
  charts: [
    { part: "Guitar", level: "Easy", count: 48 },
    { part: "Guitar", level: "Expert", count: 64 },
    { part: "Drums", level: "Easy", count: 48 },
  ],
};
function practiceChart(part, level) {
  const count = level === "Expert" ? 64 : 48;
  return {
    part,
    level,
    tempos: [{ time: 0, bpm: 120 }],
    signatures: [{ time: 0, numerator: 4, denominator: 4 }],
    notes: Array.from({ length: count }, (_, i) => ({
      time: 2 + i * (28 / count),
      duration: level === "Expert" && i % 16 === 15 ? 0.8 : 0,
      type:
        level === "Expert" && i % 8 >= 4
          ? i % 8 === 7
            ? "tap"
            : "hopo"
          : "strum",
      ...(part !== "Drums" && i % 16 < 4 ? { phrase: Math.floor(i / 16) } : {}),
      lanes: [i % 5],
    })),
  };
}
class Library {
  constructor(root) {
    this.root = root;
    this.entries = new Map();
  }
  async scan() {
    const entries = new Map();
    const songs = [practice],
      warnings = [];
    await fs.mkdir(this.root, { recursive: true });
    const root = await fs.realpath(this.root);
    let visited = 0;
    const walk = async (dir, depth) => {
      if (depth > 5 || visited++ > 3000) return;
      const list = await fs.readdir(dir, { withFileTypes: true });
      if (list.some((e) => e.name === "song.ini" && e.isFile())) {
        try {
          const safeFile = async (name) => {
            const file = path.join(dir, name);
            const stat = await fs.lstat(file);
            if (!stat.isFile() || stat.isSymbolicLink())
              throw Error("Linked song files are not supported.");
            const real = await fs.realpath(file);
            if (!real.startsWith(root + path.sep))
              throw Error("Song is outside the library.");
            return { file: real, stat };
          };
          const infoFile = await safeFile("song.ini");
          if (infoFile.stat.size > 65536)
            throw Error("Song metadata is too large.");
          const info = ini(await fs.readFile(infoFile.file, "utf8"));
          const midi = await safeFile("notes.mid");
          if (midi.stat.size > 20 * 1024 * 1024)
            throw Error("MIDI exceeds 20 MB.");
          const charts = parseMidi(await fs.readFile(midi.file), info);
          let audio;
          for (const name of [
            "song.ogg",
            "song.opus",
            "song.mp3",
            "song.wav",
          ]) {
            if (list.some((e) => e.name === name)) {
              audio = await safeFile(name);
              break;
            }
          }
          if (!audio || audio.stat.size > 250 * 1024 * 1024)
            throw Error("Missing audio or audio exceeds 250 MB.");
          const id = crypto
            .createHash("sha256")
            .update(dir)
            .digest("hex")
            .slice(0, 32);
          const duration = Math.max(
            ...charts.map(
              (c) =>
                c.notes[c.notes.length - 1].time +
                c.notes[c.notes.length - 1].duration,
            ),
          );
          // Preview from song.ini preview_start_time (ms), else a third in.
          const authored = Number(info.preview_start_time) / 1000;
          const preview =
            Number.isFinite(authored) && authored > 0 && authored < duration
              ? authored
              : Math.max(0, duration / 3);
          const song = {
            id,
            title: info.name || path.basename(dir),
            artist: info.artist || "Unknown artist",
            duration,
            preview,
            charts: charts.map((c) => ({
              part: c.part,
              level: c.level,
              count: c.notes.length,
            })),
          };
          entries.set(id, { song, charts, audio: audio.file, dir });
          songs.push(song);
        } catch (error) {
          warnings.push(path.basename(dir) + ": " + error.message);
        }
        return;
      }
      for (const entry of list) {
        if (entry.isDirectory() && !entry.name.startsWith("."))
          await walk(path.join(dir, entry.name), depth + 1);
      }
    };
    await walk(root, 0);
    this.entries = entries;
    return { songs, warnings, root: this.root };
  }
  load(id, part, level) {
    if (id === "practice") {
      if (!practice.charts.some((c) => c.part === part && c.level === level))
        throw Error("Choose an available track.");
      return { ...practice, chart: practiceChart(part, level) };
    }
    const entry = this.entries.get(id);
    if (!entry) throw Error("Song unavailable. Refresh your library.");
    const chart = entry.charts.find(
      (c) => c.part === part && c.level === level,
    );
    if (!chart) throw Error("Choose an available track.");
    return { ...entry.song, chart, audioUrl: `backstage://app/audio/${id}` };
  }
  /** Moves a scanned song's folder out of the library via `trash`. Only a real
   * directory strictly inside the real Songs root can be removed. */
  async remove(id, trash) {
    if (id === "practice") throw Error("The practice track can’t be removed.");
    const entry = this.entries.get(id);
    if (!entry) throw Error("Song unavailable. Refresh your library.");
    const root = await fs.realpath(this.root);
    const stat = await fs.lstat(entry.dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Song folder changed. Refresh your library.");
    const dir = await fs.realpath(entry.dir);
    if (dir === root || !dir.startsWith(root + path.sep))
      throw Error("Song is outside the library.");
    await trash(dir);
    this.entries.delete(id);
    return { title: entry.song.title };
  }
  async audio(id) {
    const entry = this.entries.get(id);
    if (!entry) throw Error("Unknown song.");
    const actual = await fs.realpath(entry.audio);
    const root = await fs.realpath(this.root);
    if (actual !== entry.audio || !actual.startsWith(root + path.sep))
      throw Error("Song path changed. Refresh your library.");
    return actual;
  }
}
module.exports = { Library, parseMidi, ini, practice, practiceChart };
