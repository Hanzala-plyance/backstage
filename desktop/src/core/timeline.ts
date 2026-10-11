import type { Tempo, Signature } from "../types";
/** Integrates musical time across tempo and meter changes, independent of frames. */
export class Timeline {
  private segments: {
    time: number;
    beat: number;
    measure: number;
    bpm: number;
    beatsPerMeasure: number;
  }[] = [];
  constructor(tempos: Tempo[] = [], signatures: Signature[] = []) {
    const times = [
      ...new Set([
        0,
        ...tempos.map((t) => t.time),
        ...signatures.map((s) => s.time),
      ]),
    ].sort((a, b) => a - b);
    let bpm = 120,
      beatsPerMeasure = 4,
      beat = 0,
      measure = 0,
      previous = 0;
    for (const time of times) {
      const delta = ((time - previous) * bpm) / 60;
      beat += delta;
      measure += delta / beatsPerMeasure;
      const tempo = tempos.find((t) => t.time === time);
      const signature = signatures.find((s) => s.time === time);
      if (tempo && tempo.bpm > 0) bpm = tempo.bpm;
      if (signature)
        beatsPerMeasure = (signature.numerator * 4) / signature.denominator;
      this.segments.push({ time, beat, measure, bpm, beatsPerMeasure });
      previous = time;
    }
  }
  position(time: number) {
    let low = 0,
      high = this.segments.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.segments[mid].time <= time) low = mid;
      else high = mid - 1;
    }
    const s = this.segments[low],
      delta = ((time - s.time) * s.bpm) / 60;
    return {
      beat: s.beat + delta,
      measure: s.measure + delta / s.beatsPerMeasure,
    };
  }
  rates(time: number) {
    let i = 0;
    while (
      i + 1 < this.segments.length &&
      this.segments[i + 1].time <= time + 1e-10
    )
      i++;
    const s = this.segments[i];
    return {
      beats: s.bpm / 60,
      measures: s.bpm / 60 / s.beatsPerMeasure,
      next: this.segments[i + 1]?.time ?? Infinity,
    };
  }
  timeAtBeat(beat: number) {
    let s = this.segments[0];
    for (const segment of this.segments) {
      if (segment.beat > beat) break;
      s = segment;
    }
    return s.time + ((beat - s.beat) * 60) / s.bpm;
  }
  /** Beat times up to `until`, flagging bar lines, for the highway grid. */
  beatGrid(until: number, limit = 20000) {
    const grid: { time: number; downbeat: boolean }[] = [];
    for (let beat = 0; grid.length < limit; beat++) {
      const time = this.timeAtBeat(beat);
      if (time > until) break;
      const measure = this.position(time).measure;
      grid.push({
        time,
        downbeat: Math.abs(measure - Math.round(measure)) < 1e-6,
      });
    }
    return grid;
  }
  timeAtMeasure(measure: number) {
    let s = this.segments[0];
    for (const segment of this.segments) {
      if (segment.measure > measure) break;
      s = segment;
    }
    return s.time + ((measure - s.measure) * s.beatsPerMeasure * 60) / s.bpm;
  }
}
