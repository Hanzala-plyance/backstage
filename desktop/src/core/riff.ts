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
  /** The receiver: being opened, open, released by a person, held by another
   * program, or failed. */
  state?: "closed" | "opening" | "open" | "released" | "held" | "error";
  /** Whether the guitar on this receiver has announced itself or played. */
  guitar?: "waiting" | "connected";
  /** What is going on, in plain words. */
  reason?: string;
  /** GIP packets received, by command ("0x20" input, "0x02" announce…). */
  packets?: Record<string, number>;
  /** Milliseconds since the connected guitar last sent anything. */
  quietFor?: number | null;
};
/** A MacRiff process that may be holding a receiver (staff tools). */
export type MacRiffReader = {
  pid: number;
  user: string;
  started: string;
  kind: "supervisor" | "reader";
  device: string | null;
  session: string;
  phase: string;
  stale: boolean;
  reason: string;
};
/** Debug report from the main process (Controller tools). */
export type RiffReport = {
  created: string;
  platform: string;
  mode: "direct" | "admin";
  receivers: { key: string; configuration: number | null }[];
  released: string[];
  ports: {
    key: string;
    index: number;
    state: string;
    guitar: string;
    reason: string;
    error: string;
    packets: Record<string, number>;
    lastPacket: string | null;
    events: { at: string; text: string }[];
  }[];
  macriff: MacRiffReader[];
  [more: string]: unknown;
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
/** Riffmasters are numbered by their port's index (from 16), which stays the
 * same while Backstage runs, so a guitar keeps its name (and its player)
 * when another receiver comes or goes. */
export const riffNumber = (p: { index: number }) => p.index - 15;
let pads: RiffPad[] = [];
const listeners = new Set<(pads: RiffPad[]) => void>();
/** A Gamepad-shaped snapshot of one Riffmaster. */
export function asGamepad(p: RiffPad): Gamepad {
  return {
    // No port in the id: a guitar back on another USB port gets the same
    // number, so it keeps its player and its mapping.
    id: riffName(riffNumber(p)),
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
      pads.forEach((p) => {
        while (list.length < p.index) list.push(null);
        list[p.index] = asGamepad(p);
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
