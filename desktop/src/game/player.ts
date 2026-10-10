import type { Chart, InputState, Profile } from "../types";
import { Judgment } from "../core/judgment";
import { keyboardLanes, readPad } from "../core/input";
import { isPad } from "../core/players";
import { createHighway } from "./highway";
export type MidiPort = { id: string; name: string; input: MIDIInput };
export type PlayerInit = {
  device: string;
  chart: Chart;
  profile: Profile;
  label: string;
};
export type PadEdges = {
  connected: boolean;
  start: boolean;
  up: boolean;
  down: boolean;
  green: boolean;
  red: boolean;
};
const idle = (): InputState => ({
  lanes: [false, false, false, false, false],
  strum: false,
  strumUp: false,
  strumDown: false,
  starPower: false,
  whammy: false,
  pause: false,
  connected: true,
});
export const drumNotes: Record<number, number> = {
  35: 0,
  36: 0,
  38: 1,
  40: 1,
  42: 2,
  44: 2,
  46: 2,
  45: 3,
  47: 3,
  48: 3,
  50: 3,
  49: 4,
  51: 4,
  52: 4,
  55: 4,
  57: 4,
  59: 4,
};
/** One player's judgment, highway and input state. Input only ever reaches the
 * player that owns the device, so players cannot score for each other. */
export class PlayerRuntime {
  judge: Judgment;
  readonly visual: ReturnType<typeof createHighway>;
  readonly strumMode: boolean;
  readonly keys = new Set<string>();
  readonly pulse = [0, 0, 0, 0, 0];
  held = [false, false, false, false, false];
  private prev = idle();
  private seeded = false;
  constructor(
    readonly init: PlayerInit,
    canvas: HTMLCanvasElement,
    mode: "tap" | "strum",
    duration: number,
    pixelRatio: number,
  ) {
    this.judge = new Judgment(init.chart.notes, 0.14, init.chart);
    this.strumMode = mode === "strum" && init.chart.part !== "Drums";
    const last = init.chart.notes[init.chart.notes.length - 1];
    this.visual = createHighway(
      canvas,
      init.chart.notes,
      this.judge.timeline.beatGrid(
        (last ? last.time + last.duration : duration) + 5,
      ),
      pixelRatio,
    );
  }
  get device() {
    return this.init.device;
  }
  private strike(t: number, held: boolean[]) {
    this.judge.strike(t, held, this.strumMode);
  }
  /** Keyboard events, delivered only to the keyboard player while playing. */
  keyDown(code: string, t: number) {
    this.keys.add(code);
    const lanes = keyboardLanes.map((k) => this.keys.has(k));
    if (code.startsWith("Shift")) this.judge.activate(t);
    if (code === "KeyW") this.judge.update(t, lanes, true);
    if (this.strumMode) {
      if (["Space", "ArrowUp", "ArrowDown"].includes(code))
        this.strike(t, lanes);
      else if (keyboardLanes.includes(code)) this.judge.fret(t, lanes);
    } else if (keyboardLanes.includes(code)) this.strike(t, lanes);
  }
  keyUp(code: string, t: number) {
    this.keys.delete(code);
    const held = keyboardLanes.map((k) => this.keys.has(k));
    if (this.strumMode && keyboardLanes.includes(code))
      this.judge.fret(t, held);
    else this.judge.update(t, held, this.keys.has("KeyW"));
  }
  midiHit(lane: number, t: number) {
    this.pulse[lane] = performance.now() + 80;
    this.strike(
      t,
      this.pulse.map((p) => p > performance.now()),
    );
  }
  release() {
    this.keys.clear();
    this.pulse.fill(0);
  }
  /** Reads this player's pad; returns menu edges and connection state. */
  poll(t: number, playing: boolean): PadEdges {
    const none = {
      connected: true,
      start: false,
      up: false,
      down: false,
      green: false,
      red: false,
    };
    if (!isPad(this.device)) return none;
    const index = Number(this.device.split(":")[1]);
    const pad = navigator.getGamepads()[index];
    const valid =
      pad && this.device === `pad:${pad.index}:${pad.id}` ? pad : null;
    const state = readPad(valid, this.init.profile);
    if (!state.connected) {
      this.seeded = false;
      this.prev = idle();
      this.held = [false, false, false, false, false];
      return { ...none, connected: false };
    }
    this.held = state.lanes;
    // Ignore buttons already held when the stage opened or the pad returned.
    if (!this.seeded) {
      this.prev = state;
      this.seeded = true;
    }
    const prev = this.prev;
    const edges = {
      connected: true,
      start: state.pause && !prev.pause,
      up: state.strumUp && !prev.strumUp,
      down: state.strumDown && !prev.strumDown,
      green: state.lanes[0] && !prev.lanes[0],
      red: state.lanes[1] && !prev.lanes[1],
    };
    if (playing) {
      if (this.strumMode) {
        if (edges.up || edges.down) this.strike(t, state.lanes);
        else if (state.lanes.some((v, i) => v !== prev.lanes[i]))
          this.judge.fret(t, state.lanes);
      } else if (state.lanes.some((v, i) => v && !prev.lanes[i]))
        this.strike(t, state.lanes);
      if (state.starPower && !prev.starPower) this.judge.activate(t);
      this.judge.update(t, state.lanes, state.whammy);
    }
    this.prev = state;
    return edges;
  }
  /** Advances judgment for non-pad inputs and draws the highway. */
  frame(t: number, playing: boolean, now: number) {
    if (this.device === "keyboard")
      this.held = keyboardLanes.map((k) => this.keys.has(k));
    else if (this.device === "midi") this.held = this.pulse.map((p) => p > now);
    if (playing) {
      if (this.device === "keyboard")
        this.judge.update(t, this.held, this.keys.has("KeyW"));
      else if (!isPad(this.device)) this.judge.advance(t);
    }
    const j = this.judge;
    this.visual.render(t, j.state, this.held, {
      power: j.powerActive,
      lastHit: j.lastHit,
      lanes: j.lastLanes,
      tailActive: (index, lane) => j.sustainActive(index, lane),
      streak: j.combo,
    });
  }
  stats(finished: boolean) {
    const j = this.judge;
    return {
      score: j.score,
      combo: finished ? j.maxCombo : j.combo,
      maxCombo: j.maxCombo,
      accuracy: j.accuracy,
      last: j.last,
      multiplier: j.multiplier,
      power: j.power,
      powerActive: j.powerActive,
    };
  }
  reset() {
    this.judge = new Judgment(this.init.chart.notes, 0.14, this.init.chart);
    this.visual.reset();
    this.release();
  }
  dispose() {
    this.visual.dispose();
  }
}
export type PlayerStats = ReturnType<PlayerRuntime["stats"]>;
