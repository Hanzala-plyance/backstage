// MIDI semantics follow the pinned YARG.Core/Moonscraper loader. See notices.
const { Midi } = require("@tonejs/midi");
const { parseMidi: rawMidi } = require("midi-file");
const parts = {
  "PART GUITAR": "Guitar",
  "T1 GEMS": "Guitar",
  "PART BASS": "Bass",
  "PART RHYTHM": "Rhythm",
  "PART DRUMS": "Drums",
};
const levels = { Easy: 60, Medium: 72, Hard: 84, Expert: 96 };
function parseMidi(bytes, settings = {}) {
  const raw = rawMidi(bytes),
    midi = new Midi(bytes);
  if (!raw.header.ticksPerBeat)
    throw Error("SMPTE MIDI timing is unsupported.");
  const ppq = midi.header.ppq;
  const cutoff =
    Number.isFinite(Number(settings.sustain_cutoff_threshold)) &&
    Number(settings.sustain_cutoff_threshold) >= 0
      ? Math.max(1, Number(settings.sustain_cutoff_threshold))
      : ppq / 3;
  const legacyHopo = Number(settings.hopofreq);
  const threshold =
    Number(settings.hopo_frequency) > 0
      ? Number(settings.hopo_frequency)
      : settings.eighthnote_hopo !== undefined
        ? ppq /
          (["true", "1"].includes(
            String(settings.eighthnote_hopo).toLowerCase(),
          )
            ? 2
            : 3)
        : Number.isInteger(legacyHopo) && legacyHopo >= 0 && legacyHopo <= 5
          ? (4 * ppq) / [24, 16, 12, 8, 6, 4][legacyHopo]
          : ppq / 3;
  const tempos = midi.header.tempos.map((t) => ({
    time: midi.header.ticksToSeconds(t.ticks),
    bpm: t.bpm,
  }));
  const signatures = midi.header.timeSignatures.map((s) => ({
    time: midi.header.ticksToSeconds(s.ticks),
    numerator: s.timeSignature[0],
    denominator: s.timeSignature[1],
  }));
  const metadata = new Map();
  for (const track of raw.tracks) {
    let tick = 0,
      name = "",
      enhanced = false;
    const spans = [],
      active = new Map();
    for (const event of track) {
      tick += event.deltaTime;
      if (event.type === "trackName") name = event.text;
      if (event.text?.replace(/[\[\]]/g, "") === "ENHANCED_OPENS")
        enhanced = true;
      const d = event.data;
      if (
        event.type !== "sysEx" ||
        d?.length !== 8 ||
        d[0] !== 0x50 ||
        d[1] !== 0x53 ||
        d[2] !== 0 ||
        d[3] !== 0
      )
        continue;
      const key = `${d[4]}:${d[5]}`;
      if (d[6] === 1) active.set(key, tick);
      else if (active.has(key)) {
        spans.push({
          difficulty: d[4],
          code: d[5],
          start: active.get(key),
          end: tick,
        });
        active.delete(key);
      }
    }
    metadata.set(name, { enhanced, spans });
  }
  const charts = [];
  for (const track of midi.tracks) {
    const part = parts[track.name];
    if (!part) continue;
    const guitar = part !== "Drums",
      meta = metadata.get(track.name) ?? { enhanced: false, spans: [] };
    const phrases = track.notes
      .filter((n) => n.midi === 116)
      .map((n) => ({ start: n.time, end: n.time + n.duration }));
    const solos = track.notes
      .filter((n) => n.midi === 103)
      .map((n) => ({ start: n.time, end: n.time + n.duration }));
    for (const [difficulty, [level, base]] of Object.entries(
      Object.entries(levels),
    )) {
      const groups = new Map();
      for (const n of track.notes) {
        const open = guitar && meta.enhanced && n.midi === base - 1;
        if (!open && (n.midi < base || n.midi > base + 4)) continue;
        if (
          !Number.isFinite(n.time) ||
          n.time < 0 ||
          !Number.isFinite(n.duration) ||
          n.duration < 0
        )
          throw Error("Invalid chart timing.");
        let chord = groups.get(n.ticks);
        if (!chord) {
          chord = {
            time: n.time,
            duration: 0,
            lanes: [],
            tails: [],
            ticks: n.ticks,
            type: "strum",
          };
          groups.set(n.ticks, chord);
        }
        const sysexOpen =
          guitar &&
          n.midi === base &&
          meta.spans.some(
            (s) =>
              (s.difficulty === 255 || s.difficulty === Number(difficulty)) &&
              s.code === 1 &&
              n.ticks >= s.start &&
              n.ticks < s.end,
          );
        const lane = open || sysexOpen ? -1 : n.midi - base;
        if (lane === -1) chord.open = true;
        else if (!chord.lanes.includes(lane)) chord.lanes.push(lane);
        // MIDI short note lengths are authoring gates, not scored sustains.
        const duration = n.durationTicks >= cutoff && guitar ? n.duration : 0;
        chord.tails.push({ lane, duration });
        chord.duration = Math.max(chord.duration, duration);
      }
      const notes = [...groups.values()].sort((a, b) => a.time - b.time);
      if (notes.length > 100000) throw Error("Chart has too many notes.");
      const markers = new Map(
        [base + 5, base + 6, 104].map((pitch) => [
          pitch,
          track.notes.filter((n) => n.midi === pitch),
        ]),
      );
      const inMarker = (pitch, tick) => {
        const spans = markers.get(pitch);
        let lo = 0,
          hi = spans.length - 1,
          found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (spans[mid].ticks <= tick) {
            found = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        return (
          found >= 0 && tick < spans[found].ticks + spans[found].durationTicks
        );
      };
      notes.forEach((n, i) => {
        const previous = notes[i - 1];
        n.lanes.sort((a, b) => a - b);
        if (guitar) {
          if (
            previous &&
            n.lanes.length <= 1 &&
            n.ticks - previous.ticks <= threshold &&
            (n.open !== previous.open ||
              n.lanes.join() !== previous.lanes.join())
          )
            n.type = "hopo";
          if (inMarker(base + 5, n.ticks)) n.type = "hopo";
          if (inMarker(base + 6, n.ticks)) n.type = "strum";
          if (
            inMarker(104, n.ticks) ||
            meta.spans.some(
              (s) =>
                (s.difficulty === 255 || s.difficulty === Number(difficulty)) &&
                s.code === 4 &&
                n.ticks >= s.start &&
                n.ticks < s.end,
            )
          )
            n.type = "tap";
          const phrase = phrases.findIndex(
            (p) => n.time >= p.start && n.time < p.end,
          );
          if (phrase >= 0) n.phrase = phrase;
          const solo = solos.findIndex(
            (p) => n.time >= p.start && n.time < p.end,
          );
          if (solo >= 0) n.solo = solo;
          if (n.open && n.lanes.length)
            throw Error("Mixed open/fretted chords are not supported yet.");
        }
      });
      notes.forEach((n) => delete n.ticks);
      if (notes.length)
        charts.push({ part, level, notes, tempos, signatures, phrases, solos });
    }
  }
  if (!charts.length) throw Error("No supported five-lane MIDI tracks.");
  return charts;
}
module.exports = { parseMidi };
