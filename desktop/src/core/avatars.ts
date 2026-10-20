// Player names and avatars: premade performers in the game's neon style (some
// nodding to rock legends' face paint and fashion), or a camera photo
// restyled to match.
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
  | "swoop"
  | "waves"
  | "curtain"
  | "sidecut"
  | "puffs"
  | "braids"
  | "pigtails"
  | "highpony"
  | "mullet"
  | "curls"
  | "teased"
  | "quiff"
  | "slick"
  | "tabby";
export type Extra =
  | "shades"
  | "visor"
  | "headphones"
  | "bandana"
  | "choker"
  | "hoops"
  | "tophat"
  | "headband"
  | "nosering"
  | "glasses"
  | "scarf"
  | "none";
/** Makeup and face paint drawn on the face. */
export type FaceStyle = {
  lashes?: boolean;
  lips?: string;
  /** Bat-wing paint around the eyes, a star or lightning bolt over one eye,
   * or a goth tear under one. */
  paint?: "bat" | "star" | "bolt" | "tear";
  /** Facial hair colour. */
  mustache?: string;
  stubble?: boolean;
  freckles?: boolean;
  /** Heavy dark liner around the eyes. */
  eyeliner?: boolean;
};
export type Top = "tank" | "tee" | "longsleeve" | "stripes" | "hoodie";
export type Legs = "straight" | "skinny" | "ripped" | "shorts" | "flares";
export type Shoes = "sneakers" | "boots" | "platforms";
export type Graphic = "bolt" | "star" | "skull" | "heart" | "target" | "palm";
export type Preset = {
  id: string;
  name: string;
  skin: string;
  hair: string;
  style: Hair;
  outfit: string;
  accent: string;
  extra: Extra;
  /** An open jacket over the outfit. */
  jacket?: string;
  build?: "slim";
  face?: FaceStyle;
  /** Clothing: shirt cut, trousers and their colour, shoes, a print on the
   * chest and a tie. */
  top?: Top;
  legs?: Legs;
  pants?: string;
  shoes?: Shoes;
  graphic?: Graphic;
  tie?: string;
  /** Frame colour for shades and glasses. */
  extraColor?: string;
  /** Glasses frame shape and an optional lens tint. */
  frames?: "round" | "square";
  lens?: string;
  /** A polo collar on the top. */
  collar?: boolean;
  /** A signature expression: shown in portraits and on some idle beats. */
  idle?: "pout" | "shout";
  species?: "cat";
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
    top: "tee",
    graphic: "bolt",
    legs: "ripped",
    pants: "#2a2f4a",
    shoes: "sneakers",
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
    face: { stubble: true },
    top: "tank",
    legs: "skinny",
    pants: "#7a1020",
    shoes: "boots",
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
    face: { freckles: true },
    top: "longsleeve",
    legs: "flares",
    pants: "#c8a060",
    shoes: "platforms",
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
    top: "tee",
    graphic: "star",
    legs: "straight",
    pants: "#3a5a8a",
    shoes: "boots",
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
    top: "longsleeve",
    legs: "skinny",
    pants: "#1c1a26",
    shoes: "sneakers",
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
    top: "tank",
    legs: "shorts",
    pants: "#3d6b4a",
    shoes: "sneakers",
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
    face: { freckles: true },
    top: "stripes",
    legs: "skinny",
    pants: "#14121c",
    shoes: "boots",
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
    top: "hoodie",
    legs: "straight",
    pants: "#2a4a7a",
    shoes: "sneakers",
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
    face: { eyeliner: true },
    top: "tee",
    graphic: "skull",
    legs: "skinny",
    pants: "#0b0a10",
    shoes: "platforms",
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
    top: "tee",
    graphic: "heart",
    legs: "flares",
    pants: "#38506a",
    shoes: "sneakers",
  },
  // Long-haired rockers.
  {
    id: "siren",
    name: "Siren",
    skin: "#f3d1bd",
    hair: "#c2185b",
    style: "waves",
    outfit: "#1a0d16",
    accent: "#ff2e88",
    extra: "choker",
    build: "slim",
    face: { lashes: true, lips: "#c2185b" },
    top: "longsleeve",
    legs: "skinny",
    pants: "#0b0a10",
    shoes: "boots",
  },
  {
    id: "raven",
    name: "Raven",
    skin: "#e9c9b4",
    hair: "#14121c",
    style: "curtain",
    outfit: "#0e0b14",
    accent: "#c04bff",
    extra: "choker",
    build: "slim",
    jacket: "#1c1626",
    face: { eyeliner: true, lashes: true, lips: "#4a1650", paint: "tear" },
    top: "tee",
    legs: "skinny",
    pants: "#0b0a10",
    shoes: "platforms",
  },
  {
    id: "halo",
    name: "Halo",
    skin: "#f6dcc8",
    hair: "#f3ead0",
    style: "waves",
    outfit: "#181a2e",
    accent: "#38e8ff",
    extra: "headband",
    build: "slim",
    face: { lashes: true, lips: "#ff7aa8", paint: "star" },
    top: "tee",
    graphic: "star",
    legs: "flares",
    pants: "#f5f0ff",
    shoes: "platforms",
  },
  {
    id: "viper",
    name: "Viper",
    skin: "#c48a64",
    hair: "#a020f0",
    style: "sidecut",
    outfit: "#14101e",
    accent: "#3dff6e",
    extra: "nosering",
    build: "slim",
    jacket: "#232032",
    face: { lashes: true, lips: "#7a2a5a" },
    top: "tank",
    legs: "ripped",
    pants: "#232032",
    shoes: "boots",
  },
  {
    id: "juno",
    name: "Juno",
    skin: "#6b4129",
    hair: "#2a1810",
    style: "puffs",
    outfit: "#2a1430",
    accent: "#ffe03a",
    extra: "hoops",
    build: "slim",
    face: { freckles: true, lashes: true, lips: "#b0405a" },
    top: "stripes",
    legs: "flares",
    pants: "#e07a1a",
    shoes: "platforms",
  },
  {
    id: "lyric",
    name: "Lyric",
    skin: "#8d5a3b",
    hair: "#1c1210",
    style: "braids",
    outfit: "#10233a",
    accent: "#ff8a1f",
    extra: "headband",
    build: "slim",
    face: { lashes: true, lips: "#9c3a4a" },
    top: "tee",
    graphic: "target",
    legs: "straight",
    pants: "#3a5a8a",
    shoes: "sneakers",
  },
  {
    id: "starla",
    name: "Starla",
    skin: "#f4d9c4",
    hair: "#ff7ac0",
    style: "pigtails",
    outfit: "#2a0f2a",
    accent: "#ff2e88",
    extra: "none",
    build: "slim",
    face: { lashes: true, lips: "#ff2e88", paint: "star" },
    top: "tee",
    graphic: "heart",
    legs: "shorts",
    pants: "#2a0f2a",
    shoes: "platforms",
  },
  {
    id: "rogue",
    name: "Rogue",
    skin: "#dca582",
    hair: "#2f8cff",
    style: "highpony",
    outfit: "#0f1a30",
    accent: "#ffe03a",
    extra: "choker",
    build: "slim",
    jacket: "#1d2a44",
    face: { lashes: true, lips: "#c03050", paint: "bolt" },
    top: "tee",
    legs: "skinny",
    pants: "#1d2a44",
    shoes: "boots",
  },
  {
    id: "axel",
    name: "Axel",
    skin: "#e8b896",
    hair: "#d9b46a",
    style: "mullet",
    outfit: "#22140c",
    accent: "#ff8a1f",
    extra: "bandana",
    jacket: "#3a2a1c",
    face: { stubble: true },
    top: "tee",
    legs: "ripped",
    pants: "#5a7aa8",
    shoes: "boots",
  },
  {
    id: "duke",
    name: "Duke",
    skin: "#7a4a2e",
    hair: "#14121c",
    style: "curls",
    outfit: "#1b1530",
    accent: "#c04bff",
    extra: "tophat",
    jacket: "#2a1f3a",
    top: "tee",
    legs: "skinny",
    pants: "#14121c",
    shoes: "boots",
  },
  {
    id: "gunner",
    name: "Gunner",
    skin: "#f1c7a8",
    hair: "#3a2a20",
    style: "waves",
    outfit: "#101014",
    accent: "#e8312f",
    extra: "shades",
    jacket: "#18181c",
    face: { stubble: true },
    top: "tee",
    legs: "ripped",
    pants: "#2a3a5a",
    shoes: "boots",
  },
  // Rock-legend tributes: demon face paint, and a psychedelic guitar hero.
  {
    id: "demon",
    name: "Demon",
    skin: "#f2f0f5",
    hair: "#0b0a10",
    style: "teased",
    outfit: "#0b0a10",
    accent: "#c9c4d6",
    extra: "none",
    jacket: "#1a1a20",
    face: { paint: "bat", lips: "#0b0a10" },
    top: "longsleeve",
    legs: "skinny",
    pants: "#0b0a10",
    shoes: "platforms",
  },
  {
    id: "voodoo",
    name: "Voodoo",
    skin: "#6e442c",
    hair: "#1a120c",
    style: "afro",
    outfit: "#5a1f6a",
    accent: "#ffe03a",
    extra: "headband",
    jacket: "#e07a1a",
    face: { mustache: "#1a120c" },
    top: "longsleeve",
    legs: "flares",
    pants: "#c04bff",
    shoes: "boots",
  },
  // The family.
  {
    // Slicked-back hair, thick square glasses with tinted lenses, light polo.
    id: "rehan",
    name: "Rehan",
    skin: "#b07a56",
    hair: "#1c1612",
    style: "slick",
    outfit: "#e6e4df",
    accent: "#3a3a44",
    extra: "glasses",
    extraColor: "#0b0a10",
    frames: "square",
    lens: "#c8a27a",
    collar: true,
    top: "longsleeve",
    legs: "straight",
    pants: "#2e2c34",
    shoes: "boots",
    face: { stubble: true },
  },
  {
    // Curly hair, round glasses, black tee with a palm print, mid-scream.
    id: "aali",
    name: "Aali",
    skin: "#b98260",
    hair: "#17110d",
    style: "curls",
    outfit: "#121116",
    accent: "#f0e2c4",
    extra: "glasses",
    extraColor: "#2a2420",
    frames: "round",
    top: "tee",
    graphic: "palm",
    legs: "straight",
    pants: "#2a3a5a",
    shoes: "sneakers",
    idle: "shout",
  },
  {
    // Short dark hair, big smile, camel jumper and a polka-dot navy scarf.
    id: "wajiha",
    name: "Wajiha",
    skin: "#c08a64",
    hair: "#1e1410",
    style: "bob",
    outfit: "#c9a46a",
    accent: "#1c2440",
    extra: "scarf",
    build: "slim",
    top: "longsleeve",
    legs: "straight",
    pants: "#3a3040",
    shoes: "boots",
    face: { lashes: true, lips: "#a0485a" },
  },
  {
    // Big curly hair, round glasses, grey hoodie, pouting.
    id: "huz",
    name: "Huz",
    skin: "#bb8462",
    hair: "#1f1712",
    style: "curls",
    outfit: "#55627a",
    accent: "#9fb0c8",
    extra: "glasses",
    extraColor: "#3a3430",
    frames: "round",
    top: "hoodie",
    legs: "straight",
    pants: "#1c1a26",
    shoes: "sneakers",
    idle: "pout",
  },
  {
    // The cat: white with grey tabby patches, pink nose, big green eyes.
    id: "oreo",
    name: "Oreo",
    skin: "#f2efe9",
    hair: "#8a8580",
    style: "tabby",
    outfit: "#f2efe9",
    accent: "#8a8580",
    extra: "none",
    species: "cat",
    top: "tank",
    legs: "straight",
    pants: "#f2efe9",
    shoes: "sneakers",
  },
  // Tributes to well-known rock and indie looks, by costume only.
  {
    // Schoolboy shorts, tie and cap: a hard-rock lead guitarist.
    id: "thunder",
    name: "Thunder",
    skin: "#f1c7a8",
    hair: "#1f3a7a",
    style: "cap",
    outfit: "#f5f0ff",
    accent: "#e8312f",
    extra: "none",
    jacket: "#1f3a7a",
    top: "tee",
    tie: "#e8312f",
    legs: "shorts",
    pants: "#1f3a7a",
    shoes: "sneakers",
  },
  {
    // White vest, yellow jacket and a moustache: a stadium-rock frontman.
    id: "champ",
    name: "Champ",
    skin: "#d9a07a",
    hair: "#14121c",
    style: "buzz",
    outfit: "#f5f0ff",
    accent: "#ffe03a",
    extra: "none",
    jacket: "#ffe03a",
    top: "tank",
    legs: "straight",
    pants: "#f5f0ff",
    shoes: "sneakers",
    face: { mustache: "#14121c" },
  },
  {
    // Long blond hair, striped jumper, ripped jeans and white shades.
    id: "grunge",
    name: "Grunge",
    skin: "#f4d9c4",
    hair: "#e8cf7a",
    style: "long",
    outfit: "#3a6b4a",
    accent: "#e8cf7a",
    extra: "shades",
    extraColor: "#f5f0ff",
    top: "stripes",
    legs: "ripped",
    pants: "#7aa0c8",
    shoes: "sneakers",
    face: { stubble: true },
  },
  {
    // Red, white and black only: a garage-rock duo.
    id: "stripe",
    name: "Stripe",
    skin: "#f6dcc8",
    hair: "#0b0a10",
    style: "long",
    outfit: "#e8312f",
    accent: "#f5f0ff",
    extra: "none",
    top: "tee",
    legs: "skinny",
    pants: "#0b0a10",
    shoes: "boots",
  },
  {
    // Bowl cut, leather jacket, ripped jeans and sneakers: first-wave punk.
    id: "gabba",
    name: "Gabba",
    skin: "#f1c7a8",
    hair: "#14121c",
    style: "curtain",
    outfit: "#f5f0ff",
    accent: "#f5f0ff",
    extra: "shades",
    jacket: "#14121c",
    top: "tee",
    legs: "ripped",
    pants: "#5a7aa8",
    shoes: "sneakers",
  },
  {
    // Greased quiff and leather: an indie band gone rock and roll.
    id: "quiff",
    name: "Quiff",
    skin: "#f1c7a8",
    hair: "#14121c",
    style: "quiff",
    outfit: "#14121c",
    accent: "#c9c4d6",
    extra: "none",
    jacket: "#2a2630",
    top: "tee",
    legs: "skinny",
    pants: "#0b0a10",
    shoes: "boots",
  },
  {
    // Black bob, bright stage outfit and heavy eyeliner: an art-punk singer.
    id: "karma",
    name: "Karma",
    skin: "#e9c9b4",
    hair: "#0b0a10",
    style: "bob",
    outfit: "#ffe03a",
    accent: "#ff2e88",
    extra: "none",
    build: "slim",
    top: "tee",
    graphic: "star",
    legs: "skinny",
    pants: "#ff2e88",
    shoes: "boots",
    face: { lashes: true, lips: "#e8312f", eyeliner: true },
  },
  {
    // A target on the chest: sixties mod revival.
    id: "mod",
    name: "Mod",
    skin: "#c98e6b",
    hair: "#3a2a20",
    style: "swoop",
    outfit: "#f5f0ff",
    accent: "#2f8cff",
    extra: "none",
    top: "tee",
    graphic: "target",
    legs: "skinny",
    pants: "#1c1a26",
    shoes: "boots",
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
export type Mood = "groove" | "hyped" | "shred" | "miss" | "power";
/** The avatar's expression right now. */
export function moodFor(state: {
  powerActive: boolean;
  combo: number;
  missedRecently: boolean;
}): Mood {
  if (state.powerActive) return "power";
  if (state.missedRecently) return "miss";
  if (state.combo >= 30) return "shred";
  return state.combo >= 10 ? "hyped" : "groove";
}
export type Instrument = "guitar" | "bass" | "drums";
export const instrumentFor = (part: string): Instrument =>
  part === "Drums" ? "drums" : part === "Bass" ? "bass" : "guitar";
