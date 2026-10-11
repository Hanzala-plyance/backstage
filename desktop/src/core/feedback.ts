// Play feedback: a quiet "missed riff" clunk, a plucked guitar note when a
// sustain is held to its end, and a song volume that dips a little on misses
// and comes back (slightly above the player's setting) on perfect hits.
// Everything here is generated; no samples or recordings.

/** How loud the song is, relative to the player's volume. Pure, so its
 * bounds can be tested. */
export class SongGain {
  static readonly START = 1;
  static readonly MIN = 0.82;
  static readonly MAX = 1.05;
  static readonly STEP = 0.03;
  target: number = SongGain.START;
  current: number = SongGain.START;
  miss(count = 1) {
    this.target = Math.max(SongGain.MIN, this.target - SongGain.STEP * count);
  }
  perfect(count = 1) {
    this.target = Math.min(SongGain.MAX, this.target + SongGain.STEP * count);
  }
  reset() {
    this.target = this.current = SongGain.START;
  }
  /** Eases toward the target (about 0.3 s to settle) and returns the element
   * volume for a player volume, never above full device volume. */
  step(dt: number, volume: number) {
    const k = 1 - Math.exp(-Math.max(0, dt) / 0.1);
    this.current += (this.target - this.current) * k;
    return Math.max(0, Math.min(1, volume * this.current));
  }
}

// Lane pitches: an E minor pentatonic run, low to high (E3 G3 A3 B3 D4).
const LANE_HZ = [164.81, 196.0, 220.0, 246.94, 293.66];

/** Sound effects, kept well under the music. */
export class Feedback {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private lastMiss = -Infinity;
  /** `volume` is the player's song volume (0..1). */
  constructor(private volume = 0.65) {}
  private context() {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
      this.setVolume(this.volume);
    } catch {
      this.ctx = null;
    }
    return this.ctx;
  }
  setVolume(volume: number) {
    this.volume = volume;
    // Effects sit at about a fifth of the music's level.
    if (this.out) this.out.gain.value = 0.22 * volume;
  }
  /** Old-school missed riff: a short detuned stab that bends down and is
   * muffled, so it reads as "wrong" without covering the song. */
  miss() {
    const ctx = this.context();
    if (!ctx || !this.out) return;
    const now = ctx.currentTime;
    // Rapid misses share one sound instead of stacking up.
    if (now - this.lastMiss < 0.12) return;
    this.lastMiss = now;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + 0.16);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.5, now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    filter.connect(env).connect(this.out);
    for (const [type, hz, detune] of [
      ["sawtooth", 196, -18],
      ["square", 207.65, 14],
      ["sawtooth", 98, 0],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(hz, now);
      osc.frequency.exponentialRampToValueAtTime(hz * 0.78, now + 0.18);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(now);
      osc.stop(now + 0.22);
    }
  }
  /** A plucked guitar note for each lane (Karplus-Strong), for a sustain
   * held to the end. */
  sustain(lanes: number[]) {
    const ctx = this.context();
    if (!ctx || !this.out) return;
    const now = ctx.currentTime;
    const notes = lanes.length ? lanes : [0];
    for (const lane of notes) {
      const hz = LANE_HZ[lane] ?? LANE_HZ[0];
      const seconds = 1.1,
        rate = ctx.sampleRate,
        buffer = ctx.createBuffer(1, Math.floor(rate * seconds), rate),
        data = buffer.getChannelData(0),
        period = Math.max(2, Math.round(rate / hz)),
        ring = new Float32Array(period);
      let seed = 1 + lane;
      for (let i = 0; i < period; i++) {
        seed = (seed * 16807) % 2147483647;
        ring[i] = (seed / 2147483647) * 2 - 1;
      }
      for (let i = 0; i < data.length; i++) {
        const j = i % period;
        const next = ring[(j + 1) % period];
        data[i] = ring[j];
        ring[j] = 0.996 * 0.5 * (ring[j] + next);
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const env = ctx.createGain();
      env.gain.value = 0.55 / notes.length;
      src.connect(env).connect(this.out);
      src.start(now);
    }
  }
  dispose() {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.out = null;
  }
}
