import type { Action, Binding, Profile, InputState } from "../types";
export const actions: Action[] = [
  "lane0",
  "lane1",
  "lane2",
  "lane3",
  "lane4",
  "strumUp",
  "strumDown",
  "pause",
  "starPower",
  "whammy",
];
export const actionLabels: Record<Action, string> = {
  lane0: "Green / kick",
  lane1: "Red",
  lane2: "Yellow",
  lane3: "Blue",
  lane4: "Orange / green",
  strumUp: "Strum up",
  strumDown: "Strum down",
  pause: "Pause",
  starPower: "Star Power / tilt",
  whammy: "Whammy",
};
export const defaultProfile = (): Profile => ({
  deadzone: 0.55,
  bindings: Object.fromEntries(
    actions.map((a, i) => [
      a,
      { type: "button", index: [0, 1, 2, 3, 4, 12, 13, 9, 8, 6][i] },
    ]),
  ) as Profile["bindings"],
});
export function bindingActive(
  binding: Binding,
  pad: Pick<Gamepad, "buttons" | "axes">,
  deadzone: number,
): boolean {
  if (binding.type === "button") return !!pad.buttons[binding.index]?.pressed;
  return (pad.axes[binding.index] ?? 0) * (binding.direction ?? 1) > deadzone;
}
export function readPad(pad: Gamepad | null, profile: Profile): InputState {
  const read = (a: Action) =>
    !!pad && bindingActive(profile.bindings[a], pad, profile.deadzone);
  return {
    lanes: [0, 1, 2, 3, 4].map((i) => read(`lane${i}` as Action)),
    strum: read("strumUp") || read("strumDown"),
    strumUp: read("strumUp"),
    strumDown: read("strumDown"),
    starPower: read("starPower"),
    whammy: read("whammy"),
    pause: read("pause"),
    connected: !!pad?.connected,
  };
}
export function newlyPressed(
  pad: Pick<Gamepad, "buttons" | "axes">,
  previous: Pick<Gamepad, "buttons" | "axes"> | null,
): Binding | null {
  for (let i = 0; i < pad.buttons.length; i++)
    if (pad.buttons[i].pressed && !previous?.buttons[i]?.pressed)
      return { type: "button", index: i };
  for (let i = 0; i < pad.axes.length; i++)
    if (Math.abs(pad.axes[i]) > 0.65 && Math.abs(previous?.axes[i] ?? 0) < 0.35)
      return { type: "axis", index: i, direction: pad.axes[i] > 0 ? 1 : -1 };
  return null;
}
export function validProfile(value: unknown): value is Profile {
  const p = value as Profile;
  return (
    !!p &&
    Number.isFinite(p.deadzone) &&
    p.deadzone >= 0.15 &&
    p.deadzone <= 0.9 &&
    actions.every((a) => {
      const b = p.bindings?.[a];
      return (
        b &&
        ["button", "axis"].includes(b.type) &&
        Number.isInteger(b.index) &&
        b.index >= 0 &&
        b.index < 128 &&
        (b.type === "button" || b.direction === 1 || b.direction === -1)
      );
    })
  );
}
export function loadProfile(id: string): Profile {
  try {
    const p = JSON.parse(localStorage.getItem("backstage:pad:" + id) || "null");
    const migrated = p && {
      ...p,
      bindings: { ...defaultProfile().bindings, ...p.bindings },
    };
    if (validProfile(migrated)) return migrated;
  } catch {}
  return defaultProfile();
}
export const keyboardLanes = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG"];
