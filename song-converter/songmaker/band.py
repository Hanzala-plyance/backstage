"""Frequency-aware arrangements; these are heuristics, not isolated instrument stems."""
import numpy as np

INSTRUMENTS = ("Guitar", "Bass", "Rhythm", "Drums")
DIFFICULTIES = ("Easy", "Medium", "Hard", "Expert")


def build_band(spectrum, frequencies, sr, hop, rms, floor, timing, duration, guitar,
               harmonic=None, percussive=None):
    from .audio_features import sustain_end, tonal_features, tonal_onsets, chord_size

    harmonic = spectrum if harmonic is None else harmonic
    percussive = spectrum if percussive is None else percussive
    instruments = {"Guitar": guitar}
    for instrument, low, high, pitch_low, pitch_high in [('Bass', 40, 700, 40, 300), ('Rhythm', 140, 3200, 90, 1000)]:
        flux, pitch, energy = tonal_features(harmonic, frequencies, low, high, pitch_low, pitch_high)
        band_floor = max(float(np.max(energy)) * .025, 1e-5)
        events = [event for event in tonal_onsets(flux, pitch, energy, band_floor, sr, hop)
                  if event['frame'] * hop / sr < duration - .1]
        # An arrangement fallback keeps sparse/ambiguous recordings playable.
        if not events:
            events = [{'frame': min(len(rms)-1, round(n['time']*sr/hop)), 'strength': 1.0,
                       'pitch': float(pitch[min(len(pitch)-1, round(n['time']*sr/hop))])} for n in guitar['Expert']]
        edges = np.quantile([event['pitch'] for event in events], [.2, .4, .6, .8])
        tracks = {}
        pool = events
        for difficulty, gap, frets in [('Expert', .12, 5), ('Hard', .22, 5), ('Medium', .36, 4), ('Easy', .6, 3)]:
            selected = []
            for event in pool:
                frame = event['frame']
                if not selected or (frame - selected[-1]['frame']) * hop / sr >= gap:
                    selected.append(event)
            pool = selected
            notes = []
            for i, event in enumerate(selected):
                frame, value = event['frame'], event['strength']
                time = frame * hop / sr
                lane = min(frets - 1, round(int(np.searchsorted(edges, event['pitch'])) * (frets - 1) / 4))
                lanes = [lane]
                if instrument == 'Rhythm' and difficulty in ('Hard', 'Expert'):
                    size = min(2 if difficulty == 'Hard' else 3, chord_size(harmonic, frequencies, frame))
                    lanes = sorted({lane, *[(lane + 2 * offset) % 5 for offset in range(1, size)]})
                end = min(duration - .04, time + (2.4 if difficulty == 'Easy' else 1.2), selected[i + 1]['frame'] * hop / sr - .08 if i + 1 < len(selected) else duration)
                end = min(end, sustain_end(frame, int(end * sr / hop), energy, pitch,
                                          event['pitch'], band_floor, hop, sr, difficulty == 'Easy'))
                sustain = end - time >= (.3 if difficulty == 'Easy' else .4)
                notes.append({'time': time, 'tick': timing.tick(time), 'lanes': lanes,
                              'length': timing.tick(end) - timing.tick(time) if sustain else 0,
                              'duration': end - time if sustain else 0})
            tracks[difficulty] = notes
        instruments[instrument] = tracks

    from .drums import drum_events
    groups = drum_events(percussive, frequencies, sr, hop, duration, original=spectrum)
    if not groups:
        groups = [{'time': n['time'], 'hits': {1 if i % 2 else 2: 1}} for i, n in enumerate(guitar['Expert'])]
    drum_tracks = {}
    pool = groups
    for difficulty, gap, hands in [('Expert', .085, 2), ('Hard', .16, 2), ('Medium', .28, 1), ('Easy', .48, 1)]:
        notes, selected = [], []
        last_kick = -10
        for group in pool:
            time = group['time']
            if selected and time - selected[-1]['time'] < gap:
                continue
            hand_hits = sorted((lane for lane in group['hits'] if lane), key=lambda lane: -group['hits'][lane])[:hands]
            if difficulty == 'Easy':
                hand_hits = [1 if lane in (1, 3) else 2 for lane in hand_hits]
            lanes = set(hand_hits)
            if 0 in group['hits'] and time - last_kick >= max(gap, .5 if difficulty == 'Easy' else .2):
                lanes.add(0)
                last_kick = time
            if not lanes:
                continue
            selected.append(group)
            notes.append({'time': time, 'tick': timing.tick(time), 'length': 0, 'duration': 0, 'lanes': sorted(lanes)})
        pool = selected
        drum_tracks[difficulty] = notes
    instruments['Drums'] = drum_tracks
    return instruments
