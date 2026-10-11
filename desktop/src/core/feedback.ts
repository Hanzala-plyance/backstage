// Play feedback: a power-up when Star Power ignites, and a song volume that
// dips a little on misses and comes back (slightly above the player's
// setting) on perfect hits.
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

/** Sound effects, kept well under the music. */
export class Feedback {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
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
  /** Star Power ignites: a rising sweep with a bright sparkle on top. */
  powerUp() {
    const ctx = this.context();
    if (!ctx || !this.out) return;
    const now = ctx.currentTime;
    const sweep = ctx.createOscillator(),
      sweepGain = ctx.createGain(),
      filter = ctx.createBiquadFilter();
    sweep.type = "sawtooth";
    sweep.frequency.setValueAtTime(180, now);
    sweep.frequency.exponentialRampToValueAtTime(1400, now + 0.45);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.exponentialRampToValueAtTime(5200, now + 0.45);
    filter.Q.value = 6;
    sweepGain.gain.setValueAtTime(0.0001, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.35, now + 0.08);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
    sweep.connect(filter).connect(sweepGain).connect(this.out);
    sweep.start(now);
    sweep.stop(now + 0.62);
    // Sparkle: a quick major arpeggio once the sweep peaks.
    [1046.5, 1318.5, 1568, 2093].forEach((hz, i) => {
      const at = now + 0.32 + i * 0.06,
        osc = ctx.createOscillator(),
        env = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = hz;
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.28, at + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      osc.connect(env).connect(this.out!);
      osc.start(at);
      osc.stop(at + 0.4);
    });
  }
  dispose() {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.out = null;
  }
}
