import type { Profile } from "../types";
import { readPad } from "./input";
// Menu controls follow YARG/Clone Hero conventions: strum moves, green selects,
// red backs out, yellow switches section, Start pauses.
export type MenuButton =
  "green" | "red" | "yellow" | "blue" | "orange" | "up" | "down" | "start";
const buttons: MenuButton[] = [
  "green",
  "red",
  "yellow",
  "blue",
  "orange",
  "up",
  "down",
  "start",
];
const REPEAT_DELAY = 380,
  REPEAT_RATE = 110;
type Snapshot = Record<MenuButton, boolean>;
export function menuSnapshot(
  pad: Gamepad | null,
  profile: Profile,
): Snapshot | null {
  const s = readPad(pad, profile);
  if (!s.connected) return null;
  return {
    green: s.lanes[0],
    red: s.lanes[1],
    yellow: s.lanes[2],
    blue: s.lanes[3],
    orange: s.lanes[4],
    up: s.strumUp,
    down: s.strumDown,
    start: s.pause,
  };
}
/** Edge-detects menu presses across all pads. Buttons held when a pad is first
 * seen are ignored, so a press that opened a screen cannot also act on it. */
export class MenuPad {
  private previous = new Map<string, Snapshot>();
  private repeatAt = new Map<string, number>();
  poll(
    now: number,
    pads: readonly (Gamepad | null)[],
    profileFor: (pad: Gamepad) => Profile,
  ): MenuButton[] {
    const pressed: MenuButton[] = [];
    const seen = new Set<string>();
    for (const pad of pads) {
      if (!pad?.connected) continue;
      const key = `${pad.index}:${pad.id}`;
      const current = menuSnapshot(pad, profileFor(pad));
      if (!current) continue;
      seen.add(key);
      const before = this.previous.get(key);
      this.previous.set(key, current);
      if (!before) continue;
      for (const b of buttons) {
        const repeat = key + b;
        if (current[b] && !before[b]) {
          pressed.push(b);
          if (b === "up" || b === "down")
            this.repeatAt.set(repeat, now + REPEAT_DELAY);
        } else if (
          current[b] &&
          (b === "up" || b === "down") &&
          now >= (this.repeatAt.get(repeat) ?? Infinity)
        ) {
          pressed.push(b);
          this.repeatAt.set(repeat, now + REPEAT_RATE);
        } else if (!current[b]) this.repeatAt.delete(repeat);
      }
    }
    for (const key of this.previous.keys())
      if (!seen.has(key)) this.previous.delete(key);
    return pressed;
  }
}
const focusable =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])";
export function menuScope(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("[role=dialog]") ??
    document.querySelector<HTMLElement>("[data-menu-scope]")
  );
}
function candidates(scope: HTMLElement) {
  return [...scope.querySelectorAll<HTMLElement>(focusable)].filter(
    (el) => el.getClientRects().length > 0 && !el.closest("[data-menu-skip]"),
  );
}
// Script focus does not trigger :focus-visible after mouse use, so mark menu
// navigation explicitly until the pointer is used again.
let tracking = false;
function show(el: HTMLElement) {
  document.documentElement.dataset.nav = "menu";
  if (!tracking) {
    tracking = true;
    window.addEventListener(
      "pointerdown",
      () => delete document.documentElement.dataset.nav,
      true,
    );
  }
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
export function focusFirst(scope = menuScope()) {
  if (!scope) return;
  const list = candidates(scope);
  const target =
    list.find((el) => el.hasAttribute("data-menu-default")) ?? list[0];
  if (target) show(target);
}
export function moveFocus(step: 1 | -1, scope = menuScope()) {
  if (!scope) return;
  const list = candidates(scope);
  if (!list.length) return;
  const at = list.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return focusFirst(scope);
  show(list[(at + step + list.length) % list.length]);
}
/** Green on a focused control: click buttons, cycle selects. */
export function activateFocused(scope = menuScope()) {
  const el = document.activeElement as HTMLElement | null;
  if (!scope || !el || !scope.contains(el)) return focusFirst(scope);
  if (el instanceof HTMLSelectElement) {
    const next = (el.selectedIndex + 1) % el.options.length;
    // Use the native setter so React observes the change event.
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(el, el.options[next].value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else el.click();
}
export function typing(el: Element | null) {
  return (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLInputElement &&
      !["button", "checkbox", "radio"].includes(el.type))
  );
}
