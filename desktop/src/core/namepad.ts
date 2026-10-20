// Name entry for guitars, laid out like Smash Bros. Brawl's: letter-group keys
// (ABC, DEF …) and a 123 key; tap a key again within a second to cycle it.
export type PadKey =
  { label: string; chars: string } | { label: string; action: "back" | "ok" };
export const KEYPAD: PadKey[] = [
  { label: "123", chars: "1234567890" },
  { label: "ABC", chars: "ABC" },
  { label: "DEF", chars: "DEF" },
  { label: "GHI", chars: "GHI" },
  { label: "JKL", chars: "JKL" },
  { label: "MNO", chars: "MNO" },
  { label: "PQRS", chars: "PQRS" },
  { label: "TUV", chars: "TUV" },
  { label: "WXYZ", chars: "WXYZ" },
  { label: "←", action: "back" },
  { label: "OK", action: "ok" },
];
export const MAX_NAME = 8;
const REPEAT_MS = 1000;
export type LastTap = { key: number; at: number } | null;
/** Applies one press of key `index`; returns the new name and tap memory. */
export function tapKey(
  name: string,
  index: number,
  last: LastTap,
  now: number,
): { name: string; last: LastTap; done?: boolean } {
  const key = KEYPAD[index];
  if ("action" in key) {
    if (key.action === "back") return { name: name.slice(0, -1), last: null };
    return { name, last: null, done: true };
  }
  const again =
    last?.key === index && now - last.at < REPEAT_MS && name.length > 0;
  if (again) {
    const current = key.chars.indexOf(name[name.length - 1]);
    const next = key.chars[(current + 1) % key.chars.length];
    return { name: name.slice(0, -1) + next, last: { key: index, at: now } };
  }
  if (name.length >= MAX_NAME) return { name, last: null };
  return { name: name + key.chars[0], last: { key: index, at: now } };
}
