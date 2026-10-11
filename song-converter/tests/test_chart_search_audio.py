"""Search truthfulness and musical timing against known audio, not snapshots."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
from songmaker import server
from songmaker.chart_search import _search_charts, search_charts
from songmaker.chart import analyze, TempoMap
from songmaker.midi import write_midi, validate_midi


class ChartSearchTests(unittest.TestCase):
    def tearDown(self):
        _search_charts.cache_clear()

    def test_real_tracks_filters_duplicates_and_cache(self):
        chart = {'md5': 'a' * 32, 'name': 'Helicopter', 'artist': 'Bloc Party', 'charter': 'Charter',
                 'albumArtMd5': 'b' * 32, 'diff_drums': 0, 'song_length': 200000,
                 'notesData': {'noteCounts': [{'instrument':'guitar', 'difficulty':'easy', 'count':20},
                                             {'instrument':'guitar', 'difficulty':'expert', 'count':100},
                                             {'instrument':'drums', 'difficulty':'easy', 'count':0}]}}
        response = httpx.Response(201, request=httpx.Request('POST', 'https://api.enchor.us/search'),
                                 json={'data':[chart, chart, {**chart, 'md5':'../../bad'}], 'found':25})
        with patch('songmaker.chart_search.httpx.post', return_value=response) as post:
            result = search_charts('Helicopter', 'guitar', 'easy', 2)
            self.assertEqual(result, search_charts('Helicopter', 'guitar', 'easy', 2))
            post.assert_called_once()
            self.assertEqual(post.call_args.kwargs['json']['page'], 2)
            self.assertEqual(post.call_args.kwargs['json']['instrument'], 'guitar')
            self.assertEqual(post.call_args.kwargs['json']['difficulty'], 'easy')
        self.assertEqual(len(result['results']), 1)
        self.assertEqual(result['results'][0]['tracks'], {'guitar':['easy', 'expert']})
        self.assertTrue(result['has_more'])
        self.assertEqual(result['results'][0]['url'], 'https://www.enchor.us/chart/' + 'a'*32)

    def test_failure_empty_and_invalid_filters(self):
        with patch('songmaker.chart_search.httpx.post', side_effect=httpx.ReadTimeout('timeout')):
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                search_charts('test')
        response = httpx.Response(201, request=httpx.Request('POST', 'https://api.enchor.us/search'),
                                 json={'data':[], 'found':0})
        with patch('songmaker.chart_search.httpx.post', return_value=response):
            self.assertEqual(search_charts('no matches')['results'], [])
        with TestClient(server.app) as client:
            for params in [{'q':'x'}, {'q':'hi', 'instrument':'bad'}, {'q':'hi', 'difficulty':'bad'}, {'q':'hi', 'page':0}]:
                self.assertEqual(client.get('/api/charts/search', params=params).status_code, 422)
            with patch.object(server, 'search_charts', side_effect=ValueError('Unavailable')):
                self.assertEqual(client.get('/api/charts/search?q=test').status_code, 502)


class AudioAlignmentTests(unittest.TestCase):
    def test_guitar_follows_tones_over_drums_and_holds_end_at_rests(self):
        sr = 22050
        audio = np.zeros(sr * 8)
        rng = np.random.default_rng(42)
        starts = [1, 3, 5]
        for start, pitch in zip(starts, [220, 330, 440]):
            t = np.arange(round(1.4 * sr)) / sr
            tone = (np.sin(2*np.pi*pitch*t) + .35*np.sin(2*np.pi*2*pitch*t)) * .22
            envelope = np.minimum(t/.02, 1) * np.minimum((1.4-t)/.08, 1)
            audio[round(start*sr):round(start*sr)+len(t)] += tone * envelope
        for start in np.arange(.25, 7.8, .25):
            t = np.arange(round(.035*sr)) / sr
            hit = .6 * rng.normal(size=len(t)) * np.exp(-t*90)
            audio[round(start*sr):round(start*sr)+len(t)] += hit
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'melody-and-drums.wav'
            sf.write(path, audio, sr)
            analysis = analyze(path)
            easy, expert = analysis['tracks']['Easy'], analysis['tracks']['Expert']
            for start in starts:
                note = min(easy, key=lambda n: abs(n['time']-start))
                self.assertAlmostEqual(note['time'], start, delta=.07)
                self.assertGreater(note['duration'], 1)
                self.assertLessEqual(note['time'] + note['duration'], start + 1.48)
            self.assertLessEqual(len(expert), 6, 'Percussive hits should not become a guitar strum pattern')
            self.assertGreater(len(analysis['instruments']['Drums']['Expert']), 20)
            self.assertEqual(len(easy), 3)
            timing = TempoMap(**analysis['timing'])
            for n in easy:
                self.assertEqual(n['length'], timing.tick(n['time']+n['duration'])-n['tick'])
            midi = Path(tmp) / 'notes.mid'
            write_midi(midi, {'title':'Known melody', 'artist':'Test'}, analysis, [])
            validated = validate_midi(midi)
            self.assertTrue(all(validated['Guitar'].values()))

    def test_short_staccato_notes_do_not_become_holds(self):
        sr = 22050
        audio = np.zeros(sr * 4)
        for start in [.5, 1.5, 2.5]:
            t = np.arange(round(.12*sr)) / sr
            audio[round(start*sr):round(start*sr)+len(t)] = .4*np.sin(2*np.pi*330*t)*np.exp(-t*12)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'staccato.wav'
            sf.write(path, audio, sr)
            analysis = analyze(path)
        self.assertTrue(analysis['tracks']['Easy'])
        self.assertTrue(all(note['duration'] == 0 for note in analysis['tracks']['Easy']))


if __name__ == '__main__':
    unittest.main()
