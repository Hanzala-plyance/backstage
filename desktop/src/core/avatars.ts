// Player names and avatars: ten premade performers in the game's neon style,
// or a camera photo restyled to match.
export type Look =
  { kind: "preset"; id: string } | { kind: "photo"; image: string };
/** Instrument styles and where the performer stands in single player. */
export type Gear = {
  guitar: string;
  finish: string;
  kit: string;
  side: "left" | "right";
};
export type Slot = { name: string; look: Look; gear?: Gear };
// Generic style names: the shapes nod to classic designs, but brand and model
// names are trademarks, so they are not used.
export const guitarStyles = [
  {
    id: "classic-s",
    name: "Classic S",
    hint: "Double cutaway, long upper horn",
  },
  { id: "classic-t", name: "Classic T", hint: "Single cutaway slab" },
  { id: "single-cut", name: "Single Cut", hint: "Carved top, rounded" },
  { id: "double-cut", name: "Double Cut", hint: "Curvy twin horns" },
  { id: "arrow", name: "Arrow", hint: "Pointed V wings" },
];
export const finishes = [
  "#ff2e88",
  "#38e8ff",
  "#ffe03a",
  "#3dff6e",
  "#c04bff",
  "#ff8a1f",
  "#e8312f",
  "#f5f0ff",
  "#1c1a26",
];
export const drumKits = [
  {
    id: "rock",
    name: "Rock",
    hint: "Two rack toms, floor tom, crash and ride",
  },
  { id: "compact", name: "Compact", hint: "Kick, snare, hi-hat and crash" },
  {
    id: "double-kick",
    name: "Double Kick",
    hint: "Two kicks, three toms, two crashes",
  },
  { id: "electronic", name: "Electronic", hint: "Glowing hex pads" },
];
export const defaultGear = (slot: number): Gear => ({
  guitar: guitarStyles[slot % guitarStyles.length].id,
  finish: finishes[slot % finishes.length],
  kit: drumKits[slot % drumKits.length].id,
  side: slot % 2 ? "left" : "right",
});
export const gearOf = (slot: number, s?: Slot | null): Gear => ({
  ...defaultGear(slot),
  ...(s?.gear ?? {}),
});
export type Hair =
  | "spikes"
  | "mohawk"
  | "long"
  | "bob"
  | "buzz"
  | "afro"
  | "bun"
  | "cap"
  | "pony"
  | "swoop";
export type Extra = "shades" | "visor" | "headphones" | "bandana" | "none";
export type Preset = {
  id: string;
  name: string;
  skin: string;
  hair: string;
  style: Hair;
  outfit: string;
  accent: string;
  extra: Extra;
};
export const presets: Preset[] = [
  {
    id: "volt",
    name: "Volt",
    skin: "#f1c7a8",
    hair: "#38e8ff",
    style: "spikes",
    outfit: "#1b1530",
    accent: "#38e8ff",
    extra: "shades",
  },
  {
    id: "riot",
    name: "Riot",
    skin: "#c98e6b",
    hair: "#ff2e88",
    style: "mohawk",
    outfit: "#2a0f1f",
    accent: "#ff2e88",
    extra: "none",
  },
  {
    id: "nova",
    name: "Nova",
    skin: "#8d5a3b",
    hair: "#ffe03a",
    style: "afro",
    outfit: "#1f1640",
    accent: "#ffe03a",
    extra: "headphones",
  },
  {
    id: "blaze",
    name: "Blaze",
    skin: "#f4d2b5",
    hair: "#ff8a1f",
    style: "long",
    outfit: "#2b1408",
    accent: "#ff8a1f",
    extra: "bandana",
  },
  {
    id: "echo",
    name: "Echo",
    skin: "#e0b08c",
    hair: "#c04bff",
    style: "bob",
    outfit: "#170f2c",
    accent: "#c04bff",
    extra: "visor",
  },
  {
    id: "jinx",
    name: "Jinx",
    skin: "#5c3a26",
    hair: "#3dff6e",
    style: "buzz",
    outfit: "#0d2416",
    accent: "#3dff6e",
    extra: "shades",
  },
  {
    id: "moxie",
    name: "Moxie",
    skin: "#f6dcc6",
    hair: "#ff5a6e",
    style: "bun",
    outfit: "#2a0f19",
    accent: "#ff5a6e",
    extra: "headphones",
  },
  {
    id: "rook",
    name: "Rook",
    skin: "#a8724f",
    hair: "#1c1a26",
    style: "cap",
    outfit: "#121a2e",
    accent: "#2f8cff",
    extra: "none",
  },
  {
    id: "vex",
    name: "Vex",
    skin: "#d9a07a",
    hair: "#f5f5ff",
    style: "swoop",
    outfit: "#1d1029",
    accent: "#ff2e88",
    extra: "visor",
  },
  {
    id: "zara",
    name: "Zara",
    skin: "#6e442c",
    hair: "#2f8cff",
    style: "pony",
    outfit: "#0f1d33",
    accent: "#38e8ff",
    extra: "bandana",
  },
];
export const defaultLook = (slot: number): Look => ({
  kind: "preset",
  id: presets[slot % presets.length].id,
});
export const presetFor = (id: string) =>
  presets.find((p) => p.id === id) ?? presets[0];
/** Up to 8 capital letters and digits. */
export function cleanName(text: string) {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}
export const slotName = (index: number, slot?: Slot | null) =>
  slot?.name || `P${index + 1}`;
// Dark violet to hot pink to pale cyan: the stage palette.
const PALETTE = [
  [11, 7, 20],
  [58, 20, 102],
  [194, 24, 122],
  [255, 46, 136],
  [255, 166, 196],
  [210, 250, 255],
];
/** Restyles RGBA pixels: contrast-stretched brightness, posterized onto the
 * stage palette. Returns new pixels; the input is not changed. */
export function stylize(pixels: Uint8ClampedArray) {
  const count = pixels.length / 4;
  const light = new Float32Array(count);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < count; i++) {
    const l =
      0.299 * pixels[i * 4] +
      0.587 * pixels[i * 4 + 1] +
      0.114 * pixels[i * 4 + 2];
    light[i] = l;
    histogram[Math.min(255, Math.round(l))]++;
  }
  // Ignore the darkest and brightest 2% so one highlight can't flatten a face.
  const cut = count * 0.02;
  let low = 0,
    high = 255,
    seen = 0;
  while (low < 255 && (seen += histogram[low]) < cut) low++;
  seen = 0;
  while (high > 0 && (seen += histogram[high]) < cut) high--;
  const span = Math.max(1, high - low);
  const out = new Uint8ClampedArray(pixels.length);
  const steps = PALETTE.length - 1;
  for (let i = 0; i < count; i++) {
    const t = Math.min(1, Math.max(0, (light[i] - low) / span));
    // Posterize to the palette's own steps for a print-like look.
    const [r, g, b] = PALETTE[Math.round(t * steps)];
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = pixels[i * 4 + 3];
  }
  return out;
}
export type Zone = { x0: number; y0: number; x1: number; y1: number };
/** Upper corners of the frame, beside the face: where a raised hand appears. */
export const handZones: Zone[] = [
  { x0: 0, y0: 0, x1: 0.3, y1: 0.45 },
  { x0: 0.7, y0: 0, x1: 1, y1: 0.45 },
];
/** Share of pixels in a zone whose brightness changed noticeably between two
 * RGBA frames of the same size. */
export function motion(
  previous: Uint8ClampedArray,
  current: Uint8ClampedArray,
  width: number,
  height: number,
  zone: Zone,
) {
  const x0 = Math.floor(zone.x0 * width),
    x1 = Math.ceil(zone.x1 * width),
    y0 = Math.floor(zone.y0 * height),
    y1 = Math.ceil(zone.y1 * height);
  let changed = 0,
    total = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const a = previous[i] + previous[i + 1] + previous[i + 2];
      const b = current[i] + current[i + 1] + current[i + 2];
      total++;
      if (Math.abs(a - b) > 90) changed++;
    }
  return total ? changed / total : 0;
}
export type Mood = "groove" | "hyped" | "miss" | "power";
/** The avatar's expression right now. */
export function moodFor(state: {
  powerActive: boolean;
  combo: number;
  missedRecently: boolean;
}): Mood {
  if (state.powerActive) return "power";
  if (state.missedRecently) return "miss";
  return state.combo >= 10 ? "hyped" : "groove";
}
export type Instrument = "guitar" | "bass" | "drums";
export const instrumentFor = (part: string): Instrument =>
  part === "Drums" ? "drums" : part === "Bass" ? "bass" : "guitar";
