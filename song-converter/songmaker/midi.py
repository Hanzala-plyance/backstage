"""Clone Hero type-1 MIDI: explicit difficulty ranges, pro drums, and lyrics."""
from pathlib import Path
import mido
from .chart import TempoMap, RESOLUTION, clean
from .band import DIFFICULTIES

MIDI_NAMES = {'Guitar': 'PART GUITAR', 'Bass': 'PART BASS', 'Rhythm': 'PART RHYTHM', 'Drums': 'PART DRUMS'}
BASE_NOTES = dict(zip(DIFFICULTIES, (60, 72, 84, 96)))
PPQ = 480


def write_midi(path: Path, metadata: dict, analysis: dict, lyrics: list[dict]):
    midi = mido.MidiFile(type=1, ticks_per_beat=PPQ, charset='utf-8')
    timing = TempoMap(**analysis['timing'])
    def tick(t):
        return round(t * PPQ / RESOLUTION)
    song_end = tick(timing.tick(analysis['duration']))

    def track(name, events):
        result = mido.MidiTrack([mido.MetaMessage('track_name', name=name, time=0)])
        previous = 0
        # Note-offs before note-ons at the same tick prevent retrigger overlaps.
        for at, priority, message in sorted(events, key=lambda event: (event[0], event[1])):
            result.append(message.copy(time=at - previous))
            previous = at
        result.append(mido.MetaMessage('end_of_track', time=max(0, song_end - previous)))
        midi.tracks.append(result)

    def note(events, at, length, value):
        events.append((at, 2, mido.Message('note_on', note=value, velocity=100)))
        events.append((at + max(1, length), 1, mido.Message('note_off', note=value, velocity=0)))

    tempo = [(0, 0, mido.MetaMessage('time_signature', numerator=4, denominator=4))]
    tempo += [(tick(t), 0, mido.MetaMessage('set_tempo', tempo=round(60_000_000_000 / bpm)))
              for t, bpm in zip(timing.ticks, timing.bpms)]
    track(clean(metadata['title']), tempo)
    events = [(0, 0, mido.MetaMessage('text', text='[music_start]')),
              (0, 0, mido.MetaMessage('text', text='[section Intro]')),
              (song_end, 0, mido.MetaMessage('text', text='[end]'))]
    for second in range(30, max(30, int(analysis['duration']) - 5), 30):
        events.append((tick(timing.tick(second)), 0, mido.MetaMessage('text', text=f'[section Part {second // 30 + 1}]')))
    track('EVENTS', events)
    instruments = analysis.get('instruments', {'Guitar': analysis['tracks']})
    for instrument, difficulties in instruments.items():
        events = []
        toms = set()
        for difficulty in DIFFICULTIES:
            for group in difficulties[difficulty]:
                at = tick(group['tick'])
                length = tick(group['length']) if instrument != 'Drums' else 1
                for lane in group['lanes']:
                    note(events, at, length, BASE_NOTES[difficulty] + lane)
                if instrument == 'Drums' and 3 in group['lanes']:
                    toms.add(at)
        for at in sorted(toms):
            note(events, at, 1, 111)  # Blue tom; yellow/green stay cymbals.
        for start in range(16 * PPQ, song_end - 8 * PPQ, 32 * PPQ):
            if all(sum(start <= tick(n['tick']) < start + 8 * PPQ for n in difficulties[d]) >= 2 for d in DIFFICULTIES):
                note(events, start, 8 * PPQ, 116)
                if instrument == 'Drums' and start + 16 * PPQ < song_end:
                    # Four-beat activation fill after collecting the phrase.
                    for marker in range(120, 125):
                        note(events, start + 12 * PPQ, 4 * PPQ, marker)
        track(MIDI_NAMES[instrument], events)
    if lyrics:
        events = []
        for phrase in lyrics:
            start = tick(timing.tick(phrase['start']))
            end = max(start + 1, tick(timing.tick(phrase['end'])))
            note(events, start, end - start, 105)
            words = {}
            for word in phrase['words']:
                at = min(end - 1, max(start, tick(timing.tick(word['start']))))
                words.setdefault(at, []).append(clean(word['text']))
            for at, text in words.items():
                events.append((at, 3, mido.MetaMessage('lyrics', text=' '.join(text))))
        track('PART VOCALS', events)
    midi.save(path)
    return validate_midi(path, tuple(instruments))


def validate_midi(path: Path, instruments=('Guitar', 'Bass', 'Rhythm', 'Drums')):
    """Read the finished file back, require every requested difficulty, and balance notes."""
    midi = mido.MidiFile(path, charset='utf-8')
    counts = {}
    for instrument in instruments:
        tracks = [t for t in midi.tracks if t.name == MIDI_NAMES[instrument]]
        if len(tracks) != 1:
            raise ValueError(f'Missing or duplicate {instrument} MIDI track.')
        totals = {difficulty: 0 for difficulty in DIFFICULTIES}
        active = set()
        for message in tracks[0]:
            if message.type not in ('note_on', 'note_off'):
                continue
            is_on = message.type == 'note_on' and message.velocity > 0
            if is_on:
                if message.note in active:
                    raise ValueError(f'Overlapping MIDI note in {instrument}.')
                active.add(message.note)
                for difficulty, base in BASE_NOTES.items():
                    if base <= message.note <= base + 4:
                        totals[difficulty] += 1
            else:
                if message.note not in active:
                    raise ValueError(f'Unpaired MIDI note in {instrument}.')
                active.remove(message.note)
        if active or not all(totals.values()):
            raise ValueError(f'{instrument} is missing notes in one or more difficulties.')
        counts[instrument] = totals
    return counts
