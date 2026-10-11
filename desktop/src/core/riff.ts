// Connected Riffmasters appear as standard-layout controllers in
// navigator.getGamepads(), at stable indexes from 16, so every pad feature
// (menus, player assignment, mapping, disconnect pause) works with them.
export type RiffPad = {
  key: string;
  index: number;
  connected: boolean;
  input: boolean;
  buttons: number[];
  axes: number[];
  /** Why this receiver couldn't be opened, if it couldn't. */
  error?: string;
};
export type RiffStatus = {
  receivers: string[];
  connected: RiffPad[];
  busy: boolean;
  active: boolean;
  /** "direct": read by Backstage; "admin": the administrator fallback. */
  mode: "direct" | "admin";
  /** A receiver couldn't be opened directly; the fallback may help. */
  denied?: boolean;
};
export const riffName = (n: number) => `PDP Riffmaster ${n} (Xbox)`;
let pads: RiffPad[] = [];
const listeners = new Set<(pads: RiffPad[]) => void>();
/** A Gamepad-shaped snapshot of one Riffmaster. */
export function asGamepad(p: RiffPad, n: number): Gamepad {
  return {
    id: `${riffName(n)} [${p.key}]`,
    index: p.index,
    connected: p.connected,
    mapping: "standard",
    timestamp: performance.now(),
    axes: p.axes,
    buttons: p.buttons.map((v) => ({
      pressed: v > 0.5,
      value: v,
      touched: v > 0,
    })),
    hapticActuators: [],
    vibrationActuator: null,
  } as unknown as Gamepad;
}
/** Adds Riffmasters to whatever getGamepads() reports (real pads or a test
 * stand-in installed earlier). */
export function installRiff() {
  const bridge = (
    window as {
      backstageRiff?: { subscribe(l: (p: RiffPad[]) => void): () => void };
    }
  ).backstageRiff;
  if (!bridge || !navigator.getGamepads) return;
  const native = navigator.getGamepads.bind(navigator);
  Object.defineProperty(navigator, "getGamepads", {
    configurable: true,
    value: () => {
      const list: (Gamepad | null)[] = Array.from(native());
      pads.forEach((p, i) => {
        while (list.length < p.index) list.push(null);
        list[p.index] = asGamepad(p, i + 1);
      });
      return list;
    },
  });
  const set = (next: RiffPad[]) => {
    pads = next;
    listeners.forEach((l) => l(next));
  };
  bridge.subscribe(set);
  // Guitars may have connected before this page loaded.
  void window.backstage
    ?.riffStatus?.()
    .then((s) => set(s.connected))
    .catch(() => {});
}
export function onRiff(listener: (pads: RiffPad[]) => void) {
  listeners.add(listener);
  listener(pads);
  return () => void listeners.delete(listener);
}
