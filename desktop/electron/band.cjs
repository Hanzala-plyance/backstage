// Player names and avatars for the four player slots, kept on this computer.
const fs = require("node:fs");
const SLOTS = 4;
const PRESETS = [
  "volt",
  "riot",
  "nova",
  "blaze",
  "echo",
  "jinx",
  "moxie",
  "rook",
  "vex",
  "zara",
  "siren",
  "raven",
  "halo",
  "viper",
  "juno",
  "lyric",
  "starla",
  "rogue",
  "axel",
  "duke",
  "gunner",
  "demon",
  "voodoo",
  "rehan",
  "aali",
  "wajiha",
  "huz",
  "oreo",
  "thunder",
  "champ",
  "grunge",
  "stripe",
  "gabba",
  "quiff",
  "karma",
  "mod",
];
const MAX_PHOTO = 400 * 1024;
const GUITARS = ["classic-s", "classic-t", "single-cut", "double-cut", "arrow"];
const KITS = ["rock", "compact", "double-kick", "electronic"];
/** Gear is optional; only known values are kept. */
function cleanGear(gear) {
  if (!gear || typeof gear !== "object") return undefined;
  const out = {};
  if (GUITARS.includes(gear.guitar)) out.guitar = gear.guitar;
  if (typeof gear.finish === "string" && /^#[0-9a-f]{6}$/i.test(gear.finish))
    out.finish = gear.finish.toLowerCase();
  if (KITS.includes(gear.kit)) out.kit = gear.kit;
  if (gear.side === "left" || gear.side === "right") out.side = gear.side;
  return Object.keys(out).length ? out : undefined;
}
const cleanName = (text) =>
  String(text ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
function validLook(look) {
  if (look?.kind === "preset") return PRESETS.includes(look.id);
  return (
    look?.kind === "photo" &&
    typeof look.image === "string" &&
    look.image.length <= MAX_PHOTO &&
    /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(look.image)
  );
}
const fallback = (slot) => ({
  name: "",
  look: { kind: "preset", id: PRESETS[slot] },
});
class Band {
  constructor(file) {
    this.file = file;
  }
  /** All four slots; anything missing or invalid falls back to defaults. */
  all() {
    let saved = [];
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {}
    return Array.from({ length: SLOTS }, (_, i) => {
      const s = Array.isArray(saved) ? saved[i] : null;
      const gear = cleanGear(s?.gear);
      return {
        name: cleanName(s?.name),
        look: validLook(s?.look) ? s.look : fallback(i).look,
        ...(gear ? { gear } : {}),
      };
    });
  }
  save(slot, value) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS)
      throw Error("Invalid player slot.");
    if (!validLook(value?.look)) throw Error("Invalid avatar.");
    const all = this.all();
    const gear = cleanGear(value.gear);
    all[slot] = {
      ...(gear ? { gear } : {}),
      name: cleanName(value.name),
      look:
        value.look.kind === "preset"
          ? { kind: "preset", id: value.look.id }
          : { kind: "photo", image: value.look.image },
    };
    const temporary = this.file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(all));
    fs.renameSync(temporary, this.file);
    return all;
  }
}
module.exports = { Band, PRESETS, GUITARS, KITS, cleanName };
