"""Audio-driven five-fret charts and Clone Hero's text chart serializer."""
from dataclasses import dataclass
from pathlib import Path
import re

import numpy as np

RESOLUTION = 192
DIFFICULTIES = ("Easy", "Medium", "Hard", "Expert")


def clean(value: str) -> str:
    return re.sub(r'[\x00-\x1f\x7f"\\]', ' ', str(value)).strip()


@dataclass
class TempoMap:
    seconds: list[float]
    ticks: list[int]
    bpms: list[int]

    @classmethod
    def from_beats(cls, beats, bpm: float, duration: float):
        anchors = [0.0] + [float(t) for t in beats if 0.12 < t < duration]
        if len(anchors) < 4:
            return cls([0.0], [0], [round(bpm * 1000)])
        # Beat tracking may trim a long quiet intro. Extrapolate the first beat
        # interval backwards instead of stretching one MIDI beat over the intro.
        interval = float(np.median(np.diff(anchors[1:])))
        leading = list(np.arange(anchors[1] - interval, .12, -interval))[::-1]
        anchors = [0.0] + leading + anchors[1:]
        rates = [round(60000 / (b - a)) for a, b in zip(anchors, anchors[1:])]
        # Use the encoded integer tempos to eliminate cumulative rounding drift.
        encoded = [0.0]
        for rate in rates:
            encoded.append(encoded[-1] + 60000 / rate)
        return cls(encoded, [i * RESOLUTION for i in range(len(encoded))], rates + [rates[-1]])

    def tick(self, second: float) -> int:
        i = max(0, int(np.searchsorted(self.seconds, second, side="right")) - 1)
        return max(0, round(self.ticks[i] + (second - self.seconds[i]) * self.bpms[i] * RESOLUTION / 60000))


def analyze(path: Path, bpm_override: float | None = None):
    import librosa

    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = len(y) / sr
    if duration < 2:
        raise ValueError("Choose a song at least two seconds long.")
    if float(np.max(np.abs(y))) < 0.0001:
        raise ValueError("The audio is silent. Choose a song with audible music.")
    hop = 512
    spectrum = np.abs(librosa.stft(y, hop_length=hop))
    from .audio_features import separate_spectrum, guitar_features, sustain_end, tonal_onsets, chord_size
    harmonic, percussive = separate_spectrum(spectrum)
    strength = librosa.onset.onset_strength(S=librosa.amplitude_to_db(spectrum), sr=sr, hop_length=hop)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=strength, sr=sr, hop_length=hop)
    bpm = bpm_override or float(np.asarray(tempo).reshape(-1)[0]) or 120.0
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
    timing = TempoMap([0.0], [0], [round(bpm * 1000)]) if bpm_override else TempoMap.from_beats(beats, bpm, duration)
    rms = librosa.feature.rms(S=spectrum)[0]
    floor = max(float(np.max(rms)) * 0.035, 0.0001)
    # Pitch register influences fret position; density and accents influence chords.
    frequencies = librosa.fft_frequencies(sr=sr)
    guitar_strength, pitches, guitar_energy = guitar_features(harmonic, frequencies)
    guitar_floor = max(float(np.max(guitar_energy)) * .025, 1e-5)
    candidates = []
    for event in tonal_onsets(guitar_strength, pitches, guitar_energy, guitar_floor, sr, hop):
        frame = event['frame']
        time = frame * hop / sr
        if time >= duration - .08 or rms[frame] < floor:
            continue
        candidates.append({**event, 'time': time, 'tick': timing.tick(time)})
    # Sustained music with few transients: use audible beat locations as a fallback.
    if not candidates:
        for t in np.arange(0.5, duration - 0.1, 60 / bpm):
            frame = min(len(rms) - 1, round(t * sr / hop))
            if rms[frame] >= floor:
                candidates.append({"time": float(t), "tick": timing.tick(t), "strength": float(strength[frame]),
                                   "pitch": float(pitches[frame]), "frame": frame})
    candidates.sort(key=lambda n: n["time"])
    if not candidates:
        raise ValueError("No playable musical events were detected in this audio.")
    pitch_edges = np.quantile([n["pitch"] for n in candidates], [0.2, 0.4, 0.6, 0.8])
    tracks = {}
    pool = candidates
    for difficulty, gap, lanes in [("Expert", .09, 5), ("Hard", .18, 5), ("Medium", .32, 4), ("Easy", .55, 3)]:
        selected = []
        for note in pool:
            if selected and note["time"] - selected[-1]["time"] < gap:
                continue
            if selected and difficulty == 'Easy':
                previous = selected[-1]
                end = sustain_end(previous['frame'], int(min(duration, previous['time'] + 2.8) * sr / hop),
                                  guitar_energy, pitches, previous['pitch'], guitar_floor, hop, sr, True)
                if end - previous['time'] >= .8 and note['time'] < end + .08:
                    continue
            selected.append(note)
        pool = selected
        notes = []
        for index, note in enumerate(selected):
            lane = min(lanes - 1, round(int(np.searchsorted(pitch_edges, note["pitch"])) * (lanes - 1) / 4))
            next_t = selected[index + 1]["time"] if index + 1 < len(selected) else duration
            tail = min(next_t - .08, note["time"] + (2.8 if difficulty == 'Easy' else 1.8), duration - .04)
            tail = min(tail, sustain_end(note['frame'], int(tail * sr / hop), guitar_energy,
                                        pitches, note['pitch'], guitar_floor, hop, sr, difficulty == 'Easy'))
            sustain = max(0, timing.tick(tail) - note["tick"]) if tail - note["time"] >= (.3 if difficulty == 'Easy' else .38) else 0
            frets = [lane]
            if difficulty in ('Hard', 'Expert') and chord_size(harmonic, frequencies, note['frame']) >= 2:
                frets = sorted({lane, lane + 2 if lane <= 2 else lane - 2})
            notes.append({"tick": note["tick"], "time": note["time"], "length": sustain,
                          "duration": tail - note["time"] if sustain else 0, "lanes": frets})
        tracks[difficulty] = notes
    envelope = [round(float(np.max(np.abs(chunk))), 4) for chunk in np.array_split(y, min(240, len(y)))]
    from .band import build_band
    instruments = build_band(spectrum, frequencies, sr, hop, rms, floor, timing, duration, tracks,
                             harmonic=harmonic, percussive=percussive)
    return {"duration": duration, "bpm": round(bpm, 2), "timing": timing.__dict__, "tracks": tracks,
            "instruments": instruments, "waveform": envelope,
            "method": "Adaptive per-instrument tonal attacks, harmonic chord evidence, transient drum classification",
            "charting_version": 4}


def render_chart(metadata: dict, analysis: dict, lyrics: list[dict]) -> str:
    timing = TempoMap(**analysis["timing"])
    lines = ["[Song]", "{", *[f'  {key} = "{clean(metadata.get(value, ""))}"' for key, value in
              [("Name", "title"), ("Artist", "artist"), ("Album", "album"), ("Genre", "genre"), ("Charter", "charter")]],
             "  Offset = 0", "  Resolution = 192", "  Player2 = bass", '  MusicStream = "song.ogg"', "}", "[SyncTrack]", "{", "  0 = TS 4"]
    for tick, bpm in zip(timing.ticks, timing.bpms):
        lines.append(f"  {tick} = B {bpm}")
    lines += ["}", "[Events]", "{"]
    events = [(0, 0, 'section Intro')]
    for second in np.arange(30, analysis["duration"] - 5, 30):
        events.append((timing.tick(second), 0, f'section Part {int(second / 30) + 1}'))
    for phrase in lyrics:
        start = timing.tick(phrase["start"])
        end = max(start + 1, timing.tick(phrase["end"]))
        events.append((start, 2, "phrase_start"))
        for word in phrase["words"]:
            events.append((max(start, min(end - 1, timing.tick(word["start"]))), 3, "lyric " + clean(word["text"])))
        events.append((end, 1, "phrase_end"))
    events.append((timing.tick(analysis["duration"]), 4, "end"))
    lines += [f'  {tick} = E "{text}"' for tick, _, text in sorted(events)] + ["}"]
    for difficulty in DIFFICULTIES:
        lines += [f"[{difficulty}Single]", "{"]
        events = []
        notes = analysis["tracks"][difficulty]
        for note in notes:
            for lane in note["lanes"]:
                events.append((note["tick"], f'N {lane} {note["length"]}'))
        # Eight-beat star power phrases, only where there are notes to collect.
        for start in range(16 * RESOLUTION, timing.tick(analysis["duration"]), 32 * RESOLUTION):
            length = 8 * RESOLUTION
            if sum(start <= n["tick"] < start + length for n in notes) >= 3:
                events.append((start, f'S 2 {length}'))
        lines += [f"  {tick} = {value}" for tick, value in sorted(events)] + ["}"]
    return "\n".join(lines) + "\n"
