// Best results per song, instrument and difficulty, kept on this computer.
const fs = require("node:fs");
const PARTS = ["Guitar", "Bass", "Rhythm", "Drums"],
  LEVELS = ["Easy", "Medium", "Hard", "Expert"];
const whole = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
class Scores {
  constructor(file) {
    this.file = file;
  }
  all() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return data && typeof data === "object" && !Array.isArray(data)
        ? data
        : {};
    } catch {
      return {};
    }
  }
  /** Saves a finished performance if it beats the stored best. */
  record(result) {
    const { id, part, level, score, stars, accuracy, maxCombo } = result ?? {};
    if (
      typeof id !== "string" ||
      !/^([a-f0-9]{32}|practice)$/.test(id) ||
      !PARTS.includes(part) ||
      !LEVELS.includes(level) ||
      !whole(score, 1e9) ||
      !whole(stars, 6) ||
      !whole(accuracy, 100) ||
      !whole(maxCombo, 1e6)
    )
      throw Error("Invalid score.");
    const all = this.all(),
      key = `${id}|${part}|${level}`,
      previous = all[key];
    if (previous && previous.score >= score) return { best: false, previous };
    all[key] = {
      score,
      stars,
      accuracy,
      maxCombo,
      date: new Date().toISOString(),
    };
    const temporary = this.file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(all));
    fs.renameSync(temporary, this.file);
    return { best: true, previous: previous ?? null };
  }
}
module.exports = { Scores };
