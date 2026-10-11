// Phone-keypad name entry for guitars: tap a key repeatedly (within a second)
// to cycle its letters, then its digit, as on an old phone.
export type PadKey =
  { label: string; chars: string } | { label: string; action: "back" | "ok" };
export const KEYPAD: PadKey[] = [
  { label: "1", chars: "1" },
  { label: "2 ABC", chars: "ABC2" },
  { label: "3 DEF", chars: "DEF3" },
  { label: "4 GHI", chars: "GHI4" },
  { label: "5 JKL", chars: "JKL5" },
  { label: "6 MNO", chars: "MNO6" },
  { label: "7 PQRS", chars: "PQRS7" },
  { label: "8 TUV", chars: "TUV8" },
  { label: "9 WXYZ", chars: "WXYZ9" },
  { label: "⌫", action: "back" },
  { label: "0", chars: "0" },
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
