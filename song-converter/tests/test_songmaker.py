import configparser
from io import BytesIO
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parent.parent
os.environ.setdefault("NUMBA_CACHE_DIR", str(ROOT / ".cache" / "numba"))

import mido
import numpy as np
from PIL import Image
import soundfile as sf
from fastapi.testclient import TestClient

from songmaker.chart import TempoMap, analyze, render_chart
from songmaker.lyrics import parse_lrc, to_lrc
from songmaker.artwork import google_candidates, public_url
from songmaker.pipeline import convert, folder_name, ffmpeg
from songmaker.midi import validate_midi
from songmaker import server
from songmaker.youtube import normalize_youtube_url, download_youtube


def fixture_audio(path):
    sr = 22050
    y = np.zeros(sr * 8, dtype=np.float32)
    for i, t in enumerate(np.arange(.5, 7.6, .125)):
        start = round(t * sr)
        length = round(.09 * sr)
        time = np.arange(length) / sr
        y[start:start + length] += (.6 * np.sin(2 * np.pi * (130 + (i % 7) * 70) * time) * np.exp(-time * 25)).astype(np.float32)
    sf.write(path, y, sr)


class FormatTests(unittest.TestCase):
    def test_video_audio_match_finds_offset_and_rejects_other_recording(self):
        from songmaker.backfill_videos import match_audio
        random = np.random.default_rng(17)
        reference = random.normal(0, .1, 80000)
        candidate = np.concatenate((np.zeros(1500), reference * .6, np.zeros(500)))
        result = match_audio(reference, candidate)
        self.assertAlmostEqual(result['offset_seconds'], .75, places=3)
        with self.assertRaises(ValueError):
            match_audio(reference, random.normal(0, .1, 80000))
    def test_conversion_failure_releases_queue_for_next_song(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, 'OUTPUT', Path(tmp)), \
             patch.object(server, 'jobs', {}), patch.object(server, 'convert', side_effect=[ValueError('Bad audio'), None]), \
             patch('logging.exception'):
            for job in ('a' * 32, 'b' * 32):
                (Path(tmp) / job).mkdir()
                server.run_job(job, Path('input.mp3'), {})
            self.assertEqual(server.jobs['a' * 32]['status'], 'error')
            self.assertEqual(server.jobs['b' * 32]['status'], 'complete')
            self.assertIn('Bad audio', (Path(tmp) / ('a' * 32) / 'error.json').read_text())
    def test_download_overlaps_conversion_but_conversions_do_not_overlap(self):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Event, Lock
        converting, downloaded = Event(), Event()
        guard = Lock()
        running = 0
        maximum = 0
        def fake_convert(*_):
            nonlocal running, maximum
            with guard:
                running += 1
                maximum = max(maximum, running)
            converting.set()
            self.assertTrue(downloaded.wait(3), 'Download did not overlap conversion')
            with guard:
                running -= 1
        def fake_download(*args, **kwargs):
            self.assertTrue(converting.wait(3))
            downloaded.set()
            return Path('input.webm'), {'title': 'Downloaded'}, {'type': 'YouTube'}
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, 'OUTPUT', Path(tmp)), \
             patch.object(server, 'jobs', {}), patch.object(server, 'convert', side_effect=fake_convert), \
             patch.object(server, 'publish', return_value={'message': 'Installed'}), \
             patch.object(server, 'download_youtube', side_effect=fake_download), ThreadPoolExecutor(2) as executor:
            one = executor.submit(server.run_job, 'a' * 32, Path('input.wav'), {})
            two = executor.submit(server.run_job, 'b' * 32, None, {'youtube_url': 'https://youtu.be/jNQXAC9IVRw'})
            one.result(timeout=5)
            two.result(timeout=5)
            self.assertEqual(maximum, 1)
            self.assertTrue(all(j['status'] == 'complete' for j in server.jobs.values()))

    def test_queue_capacity_and_restart_visibility(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(server, 'OUTPUT', Path(tmp)), \
             patch.object(server, 'jobs', {}), patch.object(server.pool, 'submit'), TestClient(server.app) as client:
            for index in range(2):
                response = client.post('/api/jobs', files={'audio': (f'song-{index}.mp3', b'fake')})
                self.assertEqual(response.status_code, 202)
            entries = client.get('/api/queue').json()
            self.assertEqual(len(entries), 2)
            self.assertEqual([item['title'] for item in entries], ['song-0.mp3', 'song-1.mp3'])
            self.assertTrue(all(item['status'] == 'queued' for item in entries))
            for index in range(18):
                server.jobs[str(index)] = {'status': 'downloading'}
            self.assertEqual(client.post('/api/jobs', files={'audio': ('extra.mp3', b'fake')}).status_code, 429)
            self.assertEqual(len(list(Path(tmp).iterdir())), 2)
            server.jobs.clear()
            recovered = client.get('/api/queue').json()
            self.assertTrue(all(item['status'] == 'error' and 'restarted' in item['message'] for item in recovered))

    def test_youtube_search_only_returns_short_single_videos(self):
        from songmaker.youtube import _search_youtube
        _search_youtube.cache_clear()
        with patch('yt_dlp.YoutubeDL') as downloader:
            downloader.return_value.__enter__.return_value.extract_info.return_value = {'entries': [
                {'id': 'jNQXAC9IVRw', 'title': 'Test', 'duration': 19},
                {'id': 'aaaaaaaaaaa', 'duration': 1201}, {'id': 'bbbbbbbbbbb', 'is_live': True, 'live_status': 'is_live'},
                {'id': '../../bad', 'duration': 19}]}
            from songmaker.youtube import search_youtube
            first = search_youtube('my search')
            self.assertEqual(len(first), 1)
            self.assertEqual(first[0]['url'], 'https://www.youtube.com/watch?v=jNQXAC9IVRw')
            self.assertEqual(search_youtube('my search'), first)
            self.assertEqual(downloader.call_count, 1)
        _search_youtube.cache_clear()

    def test_lyrics_model_is_reused_between_songs(self):
        from songmaker.lyrics import lyrics_model
        lyrics_model.cache_clear()
        with patch('faster_whisper.WhisperModel') as model:
            self.assertIs(lyrics_model('tiny'), lyrics_model('tiny'))
            self.assertEqual(model.call_count, 1)
        lyrics_model.cache_clear()

    def test_youtube_url_validation(self):
        expected = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
        for value in (expected, ' https://youtu.be/jNQXAC9IVRw?t=4 ',
                      'https://music.youtube.com/watch?v=jNQXAC9IVRw&list=ignored',
                      'https://m.youtube.com/shorts/jNQXAC9IVRw'):
            self.assertEqual(normalize_youtube_url(value), expected)
        for value in ('file:///etc/passwd', 'https://youtube.com.evil.test/watch?v=jNQXAC9IVRw',
                      'https://youtube.com/playlist?list=abc', 'https://youtube.com/@artist',
                      'https://user@youtube.com/watch?v=jNQXAC9IVRw',
                      'https://youtube.com:8765/watch?v=jNQXAC9IVRw', 'https://youtu.be/short'):
            with self.assertRaises(ValueError):
                normalize_youtube_url(value)

    def test_youtube_downloader_limits_and_video_selection(self):
        for video in (False, True):
            with self.subTest(video=video), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / ('input.mkv' if video else 'input.webm')).write_bytes(b'media')
                updates = []
                with patch('yt_dlp.YoutubeDL') as downloader:
                    downloader.return_value.__enter__.return_value.extract_info.return_value = {
                        'id': 'jNQXAC9IVRw', 'title': 'Title', 'uploader': 'Artist', 'duration': 8}
                    path, metadata, source = download_youtube('https://youtu.be/jNQXAC9IVRw', root,
                                                              lambda p, _: updates.append(p), video)
                    config = downloader.call_args.args[0]
                    self.assertEqual('bestvideo' in config['format'], video)
                    self.assertTrue(config['noplaylist'])
                    self.assertEqual(source['include_video'], video)
                    self.assertEqual(metadata['artist'], 'Artist')
                    reject = config['match_filter']
                    self.assertIn('20 minutes', reject({'duration': 1201}))
                    self.assertIn('finished', reject({'is_live': True}))
                    self.assertIn('duration', reject({}))
                    self.assertIsNone(reject({'duration': 8}))
                    hook = config['progress_hooks'][0]
                    hook({'filename': 'one', 'downloaded_bytes': 10, 'total_bytes': 10})
                    hook({'filename': 'two', 'downloaded_bytes': 1, 'total_bytes': 10})
                    self.assertEqual(updates, sorted(updates))
                    with self.assertRaisesRegex(ValueError, 'limit'):
                        hook({'filename': 'large', 'downloaded_bytes': 800 * 1024 * 1024})

    def test_youtube_api_source_validation(self):
        with TestClient(server.app) as client, patch.object(server.pool, 'submit') as submit:
            for data, files in (({}, None), ({'youtube_url': 'https://example.com/test'}, None),
                                ({'youtube_url': 'https://youtu.be/jNQXAC9IVRw'}, {'audio': ('x.mp3', b'a')}),
                                ({'youtube_video': 'true'}, {'audio': ('x.mp3', b'a')})):
                self.assertEqual(client.post('/api/jobs', data=data, files=files).status_code, 400)
            submit.assert_not_called()

    def test_youtube_quality_selects_resolution_before_codec(self):
        from yt_dlp import YoutubeDL
        formats = [
            {'format_id': 'audio', 'url': 'https://example.com/audio', 'ext': 'm4a',
             'vcodec': 'none', 'acodec': 'mp4a', 'abr': 128},
            *[{'format_id': name, 'url': f'https://example.com/{name}', 'ext': 'mp4',
               'width': height * 16 // 9, 'height': height, 'vcodec': codec, 'acodec': 'none'}
              for name, height, codec in [('720', 720, 'avc1'), ('1080', 1080, 'vp9'), ('4k', 2160, 'vp9')]]]
        for quality, expected in [('720', '720'), ('1080', '1080'), ('best', '4k')]:
            with self.subTest(quality=quality), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / 'input.mkv').write_bytes(b'media')
                with patch('yt_dlp.YoutubeDL') as downloader:
                    downloader.return_value.__enter__.return_value.extract_info.return_value = {
                        'id': 'jNQXAC9IVRw', 'title': 'Title', 'duration': 8}
                    _, _, source = download_youtube('https://youtu.be/jNQXAC9IVRw', root,
                                                   lambda *_: None, True, quality)
                    config = downloader.call_args.args[0]
                self.assertEqual(source['video_quality'], quality)
                config = {key: config[key] for key in ('format', 'format_sort')}
                with YoutubeDL({**config, 'quiet': True}) as downloader:
                    for candidates, chosen in [(formats, expected), (formats[:2], '720')]:
                        info = downloader.process_ie_result({'id': 'test', 'title': 'Test',
                                                            'formats': [dict(f) for f in candidates]}, download=False)
                        self.assertEqual(info['requested_formats'][0]['format_id'], chosen)
        with TestClient(server.app) as client, patch.object(server.pool, 'submit') as submit:
            response = client.post('/api/jobs', data={'youtube_url': 'https://youtu.be/jNQXAC9IVRw',
                                                     'youtube_quality': 'invalid'})
            self.assertEqual(response.status_code, 422)
            submit.assert_not_called()

    def test_independent_stages_overlap_and_progress_never_reverses(self):
        from threading import Barrier
        from songmaker.parallel import run_stages
        barrier = Barrier(3, timeout=3)
        updates = []
        def work(report):
            report(.5, 'working')
            barrier.wait()  # Sequential execution would time out here.
            report(.2, 'still working')
            return 'done'
        result, timings = run_stages(dict.fromkeys(('Charts', 'Lyrics', 'Artwork'), work), lambda p, _: updates.append(p))
        self.assertEqual(set(result.values()), {'done'})
        self.assertEqual(updates, sorted(updates))
        self.assertEqual(updates[-1], 92)
        self.assertEqual(set(timings), {'Charts', 'Lyrics', 'Artwork'})

    def test_long_quiet_intro_does_not_exceed_midi_tempo_limit(self):
        timing = TempoMap.from_beats(np.arange(35.3, 90, .5), 120, 90)
        self.assertLess(timing.seconds[1], 1)
        self.assertTrue(all(round(60_000_000_000 / bpm) <= 16777215 for bpm in timing.bpms))
        self.assertAlmostEqual(timing.seconds[-1], 89.8, places=3)

    def test_tempo_map_round_trip_matches_encoded_timing(self):
        timing = TempoMap.from_beats(np.arange(.4, 180, .47), 128, 180)
        for seconds in np.linspace(0, 179, 500):
            tick = timing.tick(seconds)
            i = max(0, np.searchsorted(timing.ticks, tick, side="right") - 1)
            decoded = timing.seconds[i] + (tick - timing.ticks[i]) * 60000 / (192 * timing.bpms[i])
            self.assertLess(abs(seconds - decoded), .002)

    def test_lrc_offsets_multiple_stamps_and_validation(self):
        phrases = parse_lrc('[offset:100]\n[00:01.25][00:03.00]Hello\n[00:05.00]\n', 10)
        self.assertAlmostEqual(phrases[0]["start"], 1.35)
        self.assertAlmostEqual(phrases[1]["end"], 5.1)
        for invalid in ('untimed words', '[00:70]bad', '[00:20]too late', '[00:01]a\n[00:01]b'):
            with self.assertRaises(ValueError):
                parse_lrc(invalid, 10)

    def test_word_timestamps_survive_editor_roundtrip(self):
        original = [{"start": 1.25, "end": 4, "words": [{"start": 1.25, "text": "Hello"}, {"start": 2.8, "text": "world"}]}]
        edited = parse_lrc(to_lrc(original), 10)
        self.assertEqual([p["words"][0]["start"] for p in edited], [1.25, 2.8])

    def test_simultaneous_transcribed_words_can_be_saved(self):
        phrases = [{"start": 1, "end": 2, "words": [{"start": 1, "text": "We"}, {"start": 1, "text": "sing"}]}]
        edited = parse_lrc(to_lrc(phrases), 4)
        self.assertEqual(edited[0]['words'][0]['text'], 'We sing')

    def test_google_original_extraction(self):
        page = r'[["https://example.org/art.jpg?a=1\u0026b=2",1000,1000],["https://encrypted-tbn0.gstatic.com/thumb",200,200]]'
        self.assertEqual(google_candidates(page), ['https://example.org/art.jpg?a=1&b=2'])

    def test_artwork_rejects_private_urls(self):
        for url in ('file:///etc/passwd', 'http://127.0.0.1/private', 'http://[::1]/'):
            with self.assertRaises(ValueError):
                public_url(url)

    def test_path_sanitization(self):
        self.assertNotIn('/', folder_name('../bad/name'))
        self.assertNotIn('\\', folder_name('a\\b'))

    def test_google_failure_produces_honest_cover_fallback(self):
        from songmaker.artwork import make_art
        with tempfile.TemporaryDirectory() as tmp:
            destination = Path(tmp) / 'album.png'
            warnings = []
            with patch('songmaker.artwork.google_art', side_effect=ValueError('Google blocked the request.')), \
                 patch('songmaker.artwork.embedded_art', return_value=None):
                art = make_art(Path('unused.mp3'), None, destination, 'My Song', 'My Song cover', 'google', warnings)
            self.assertEqual(art['source'], 'Generated fretboard cover')
            with Image.open(destination) as cover:
                self.assertEqual(cover.size, (768, 768))
            self.assertTrue(any('Browser' in message for message in warnings))
            self.assertNotIn('secret-key', json.dumps(warnings))

    def test_browser_result_downloads_and_converts_artwork(self):
        import httpx
        from songmaker.artwork import google_art
        picture = BytesIO()
        Image.new('RGB', (400, 300), '#ffaa22').save(picture, format='JPEG')
        def response(request):
            return httpx.Response(200, content=picture.getvalue())
        with tempfile.TemporaryDirectory() as tmp:
            client = httpx.Client(transport=httpx.MockTransport(response))
            with patch('songmaker.artwork.httpx.Client', return_value=client), patch('songmaker.artwork.public_url'), \
                 patch('songmaker.artwork.browser_image_candidates', return_value=('Google Images', ('https://images.example/cover.jpg',))):
                result = google_art('my song cover', Path(tmp) / 'album.png')
            self.assertEqual(result['source'], 'Google Images (Playwright)')
            self.assertEqual(result['url'], 'https://images.example/cover.jpg')
            with Image.open(Path(tmp) / 'album.png') as cover:
                self.assertEqual(cover.size, (768, 768))


class ConversionTests(unittest.TestCase):
    def test_add_background_keeps_charts_and_cover_edits_keep_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            job = 'd' * 32
            directory = root / job
            directory.mkdir()
            source = directory / 'input.wav'
            shutil.copy2(self.source, source)
            result = convert(directory, source, {'title': 'Keep my charts', 'artist': 'Test', 'original_stem': 'Test',
                                                'lyrics_mode': 'skip', 'art_mode': 'offline'}, lambda *_: None)
            folder = directory / result['folder']
            before = {name: (folder / name).read_bytes() for name in ('notes.mid', 'song.ogg', 'song.ini')}
            video = root / 'video.mp4'
            ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=24', '-t', '8', '-an', '-c:v', 'libx264', str(video)])
            with patch.object(server, 'OUTPUT', root), TestClient(server.app) as client:
                response = client.post(f'/api/jobs/{job}/background', files={'video': ('video.mp4', video.read_bytes())},
                                       data={'youtube_url': 'https://youtu.be/jNQXAC9IVRw'})
                self.assertEqual(response.status_code, 200, response.text)
                for name, original in before.items():
                    self.assertEqual((folder / name).read_bytes(), original)
                original_video = (folder / 'video.mp4').read_bytes()
                self.assertEqual(client.post(f'/api/jobs/{job}/background', files={'video': ('video.mp4', video.read_bytes())},
                                             data={'youtube_url': 'https://youtu.be/jNQXAC9IVRw'}).status_code, 409)
                picture = BytesIO()
                Image.new('RGB', (100, 100), 'red').save(picture, format='PNG')
                self.assertEqual(client.post(f'/api/jobs/{job}/cover', files={'cover': ('new.png', picture.getvalue())}).status_code, 200)
                self.assertEqual((folder / 'video.mp4').read_bytes(), original_video)
                with zipfile.ZipFile(directory / 'song.zip') as bundle:
                    self.assertEqual(bundle.read(result['folder'] + '/video.mp4'), original_video)
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.directory = Path(cls.temp.name)
        cls.source = cls.directory / "original.wav"
        fixture_audio(cls.source)
        cls.analysis = analyze(cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_chart_difficulty_and_audio_alignment(self):
        timing = TempoMap(**self.analysis["timing"])
        counts = []
        for difficulty, max_lane, gap in (("Easy", 2, .55), ("Medium", 3, .32), ("Hard", 4, .18), ("Expert", 4, .09)):
            notes = self.analysis["tracks"][difficulty]
            counts.append(len(notes))
            self.assertGreater(len(notes), 0)
            for i, note in enumerate(notes):
                self.assertTrue(all(0 <= lane <= max_lane for lane in note["lanes"]))
                self.assertEqual(note["tick"], timing.tick(note["time"]))
                self.assertLess(note["time"], 8)
                if i:
                    self.assertGreaterEqual(note["time"] - notes[i - 1]["time"], gap)
                    self.assertLessEqual(notes[i - 1]["tick"] + notes[i - 1]["length"], note["tick"])
        self.assertEqual(counts, sorted(counts))
        self.assertGreater(counts[-1], counts[0])

    def test_silence_is_rejected(self):
        silent = self.directory / "silent.wav"
        sf.write(silent, np.zeros(22050 * 3), 22050)
        with self.assertRaisesRegex(ValueError, "silent"):
            analyze(silent)

    def test_incompatible_video_is_encoded_to_h264(self):
        from songmaker.pipeline import youtube_background
        source = self.directory / 'mpeg4-video.mp4'
        destination = self.directory / 'h264-video.mp4'
        ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=15', '-t', '1', '-c:v', 'mpeg4', str(source)])
        self.assertEqual(youtube_background(source, destination, 1), 'Encoded H.264')
        result = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(destination)]))
        self.assertEqual(result['streams'][0]['codec_name'], 'h264')

    def test_hd_video_keeps_resolution_and_frame_rate(self):
        from songmaker.pipeline import youtube_background, video_dimensions
        for size, codec in [('1920x1080', 'libx264'), ('1920x1080', 'mpeg4'), ('3840x2160', 'libx264')]:
            with self.subTest(size=size, codec=codec):
                source = self.directory / f'{size}-{codec}.mp4'
                destination = self.directory / f'{size}-{codec}-export.mp4'
                ffmpeg(['-f', 'lavfi', '-i', f'color=size={size}:rate=60', '-t', '0.2',
                        '-c:v', codec, '-threads', '2', str(source)])
                mode = youtube_background(source, destination, .2)
                self.assertEqual(mode, 'Copied compatible H.264' if codec == 'libx264' else 'Encoded H.264')
                width, height = map(int, size.split('x'))
                self.assertEqual(video_dimensions(destination), {'width': width, 'height': height})
                streams = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                                              '-of', 'json', str(destination)]))['streams']
                self.assertEqual(len(streams), 1)
                self.assertEqual(streams[0]['codec_name'], 'h264')
                self.assertEqual(streams[0]['r_frame_rate'], '60/1')

    def test_youtube_import_with_optional_real_video_export(self):
        media = self.directory / 'fixture-video.mkv'
        ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-i', str(self.source),
                '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', str(media)])
        for include_video in (False, True):
            with self.subTest(include_video=include_video), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                def retrieve(url, directory, progress, include_video=False, video_quality='1080'):
                    destination = directory / 'input.mkv'
                    shutil.copy2(media, destination)
                    return destination, {'title': 'YouTube title', 'artist': 'YouTube artist'}, {
                        'type': 'YouTube', 'url': url, 'include_video': include_video}
                with patch.object(server, 'OUTPUT', root), patch.object(server.pool, 'submit') as submit, \
                     patch.object(server, 'download_youtube', side_effect=retrieve) as retrieve_mock, TestClient(server.app) as client:
                    response = client.post('/api/jobs', data={'youtube_url': 'https://youtu.be/jNQXAC9IVRw',
                        'youtube_video': str(include_video).lower(), 'title': 'My override',
                        'lyrics_mode': 'skip', 'art_mode': 'offline'})
                    self.assertEqual(response.status_code, 202, response.text)
                    job_id = response.json()['id']
                    worker, *args = submit.call_args.args
                    try:
                        worker(*args)
                        self.assertEqual(client.get(f'/api/jobs/{job_id}').json()['status'], 'complete')
                        self.assertEqual(retrieve_mock.call_args.kwargs['include_video'], include_video)
                        self.assertEqual(retrieve_mock.call_args.kwargs['video_quality'], '1080')
                        result = client.get(f'/api/jobs/{job_id}/result').json()
                        self.assertEqual(result['metadata']['title'], 'My override')
                        self.assertEqual(result['metadata']['artist'], 'YouTube artist')
                        self.assertEqual(result['video']['included'], include_video)
                        drums = client.get(f'/api/jobs/{job_id}/drums-check').json()
                        self.assertTrue(drums['ready'])
                        self.assertEqual(set(drums['counts']), {'Easy', 'Medium', 'Hard', 'Expert'})
                        folder = root / job_id / result['folder']
                        self.assertEqual((folder / 'video.mp4').exists(), include_video)
                        with zipfile.ZipFile(BytesIO(client.get(f'/api/jobs/{job_id}/download').content)) as bundle:
                            self.assertEqual(any(n.endswith('/video.mp4') for n in bundle.namelist()), include_video)
                            self.assertIn(result['folder'] + '/notes.mid', bundle.namelist())
                        if include_video:
                            self.assertEqual((result['video']['width'], result['video']['height']), (320, 180))
                            self.assertEqual(result['video']['processing'], 'Copied compatible H.264')
                            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                                                       '-of', 'json', str(folder / 'video.mp4')]))
                            self.assertEqual(len(probe['streams']), 1)  # Silent; song.ogg carries the audio.
                            video = probe['streams'][0]
                            self.assertEqual(video['codec_name'], 'h264')
                            self.assertEqual(video['pix_fmt'], 'yuv420p')
                            self.assertAlmostEqual(float(video['duration']), result['analysis']['duration'], delta=.1)
                        client.put(f'/api/jobs/{job_id}/metadata', json={'title': 'Edited', 'artist': 'Me'})
                        with zipfile.ZipFile(BytesIO(client.get(f'/api/jobs/{job_id}/download').content)) as bundle:
                            self.assertEqual(any(n.endswith('/video.mp4') for n in bundle.namelist()), include_video)
                    finally:
                        server.jobs.pop(job_id, None)

    def test_every_instrument_has_four_playable_reductions(self):
        self.assertEqual(set(self.analysis['instruments']), {'Guitar', 'Bass', 'Rhythm', 'Drums'})
        for instrument, tracks in self.analysis['instruments'].items():
            counts = [len(tracks[level]) for level in ('Easy', 'Medium', 'Hard', 'Expert')]
            self.assertTrue(all(counts), instrument)
            self.assertEqual(counts, sorted(counts), instrument)
            for difficulty, notes in tracks.items():
                for note in notes:
                    self.assertTrue(all(0 <= lane <= 4 for lane in note['lanes']))
                    if instrument == 'Drums':
                        self.assertEqual(note['length'], 0)
                        self.assertLessEqual(len([lane for lane in note['lanes'] if lane]), 2)

    def test_flac_and_apple_lossless_are_decoded_and_accepted(self):
        for suffix, codec, container in (('.flac', 'flac', 'flac'), ('.m4a', 'alac', 'ipod'), ('.alac', 'alac', 'ipod')):
            with self.subTest(suffix=suffix), tempfile.TemporaryDirectory() as output:
                root = Path(output)
                source = root / ('input' + suffix)
                ffmpeg(['-i', str(self.source), '-c:a', codec, '-f', container, str(source)])
                with patch.object(server, 'OUTPUT', root / 'uploads'), patch.object(server.pool, 'submit'), TestClient(server.app) as client:
                    server.OUTPUT.mkdir()
                    response = client.post('/api/jobs', files={'audio': (source.name, source.read_bytes())}, data={'lyrics_mode':'skip','art_mode':'offline'})
                    self.assertEqual(response.status_code, 202, response.text)
                    server.jobs.pop(response.json()['id'], None)
                result = convert(root, source, {'title': 'Lossless', 'artist': 'Test', 'original_stem': 'Lossless', 'lyrics_mode': 'skip', 'art_mode': 'offline'}, lambda *_: None)
                self.assertEqual(len(result['validated_tracks']), 4)
                self.assertAlmostEqual(result['analysis']['duration'], 8, places=2)

    def test_full_conversion_and_api_lyrics_update(self):
        with tempfile.TemporaryDirectory() as output:
            root = Path(output)
            job_id = "a" * 32
            job_dir = root / job_id
            job_dir.mkdir()
            source = job_dir / "input.wav"
            fixture_audio(source)
            Image.new('RGB', (200, 300), '#4488aa').save(job_dir / 'cover.upload', format='PNG')
            options = {"title": 'Test "Song"\n[Bad]', "artist": "Unit Test", "lyrics_mode": "skip", "art_mode": "offline",
                       "original_stem": "test", "lrc": "[00:01.25]Hello world\n[00:04.50]Second phrase", "video": True}
            result = convert(job_dir, source, options, lambda *_: None)
            self.assertTrue(result['loudness']['enabled'])
            self.assertEqual(result['loudness']['target_lufs'], -16)
            with zipfile.ZipFile(job_dir / "song.zip") as archive:
                report = json.loads(archive.read(result['folder'] + '/conversion-report.json'))
                self.assertEqual(report['loudness'], result['loudness'])
                names = archive.namelist()
                for file in ("notes.mid", "song.ini", "song.ogg", "album.png", "video.mp4", "lyrics.lrc"):
                    self.assertIn(result["folder"] + '/' + file, names)
                midi = mido.MidiFile(file=BytesIO(archive.read(result["folder"] + '/notes.mid')), charset='utf-8')
                self.assertNotIn(result['folder'] + '/notes.chart', names)
                self.assertEqual(set(result['validated_tracks']), {'Guitar', 'Bass', 'Rhythm', 'Drums'})
                self.assertTrue(all(len(levels) == 4 and all(levels.values()) for levels in result['validated_tracks'].values()))
                self.assertTrue(any(m.type == 'lyrics' and m.text == 'Hello world' for t in midi.tracks for m in t))
                self.assertTrue(any(m.type == 'note_on' and m.note == 105 for t in midi.tracks if t.name == 'PART VOCALS' for m in t))
                config = configparser.ConfigParser(interpolation=None)
                config.read_string(archive.read(result["folder"] + '/song.ini').decode())
                self.assertEqual(config['song']['artist'], 'Unit Test')
                self.assertEqual(config['song']['song_length'], '8000')
            with patch.object(server, 'OUTPUT', root), TestClient(server.app) as client:
                self.assertEqual(client.get('/api/jobs/' + job_id).json()['status'], 'complete')
                response = client.put(f'/api/jobs/{job_id}/lyrics', json={"text": "[00:02.00]Corrected words"})
                self.assertEqual(response.status_code, 200, response.text)
                with zipfile.ZipFile(BytesIO(client.get(f'/api/jobs/{job_id}/download').content)) as archive:
                    midi = mido.MidiFile(file=BytesIO(archive.read(result["folder"] + '/notes.mid')), charset='utf-8')
                    lyrics = [m.text for t in midi.tracks for m in t if m.type == 'lyrics']
                    self.assertIn('Corrected words', lyrics)
                    self.assertNotIn('Hello world', lyrics)
                self.assertEqual(client.put(f'/api/jobs/{job_id}/metadata', json={'title': 'New title', 'artist': 'Me'}).status_code, 200)
                self.assertEqual(client.get(f'/api/jobs/{job_id}/result').json()['metadata']['title'], 'New title')
                edited = client.put(f'/api/jobs/{job_id}/tracks/Drums/Easy', json={'notes': [{'time': 2, 'lanes': [0, 1, 2]}]})
                self.assertEqual(edited.status_code, 200, edited.text)
                self.assertEqual(edited.json()['instrument_counts']['Drums']['Easy'], 1)
                bad = client.put(f'/api/jobs/{job_id}/tracks/Drums/Easy', json={'notes': [{'time': 2, 'lanes': [1, 2, 3]}]})
                self.assertEqual(bad.status_code, 400)
                self.assertEqual(client.put(f'/api/jobs/{job_id}/tracks/Guitar/Easy', json={'notes': [{'time': 2, 'lanes': [4]}]}).status_code, 400)
                self.assertEqual(client.put(f'/api/jobs/{job_id}/tracks/Guitar/Easy', json={'notes': []}).status_code, 422)
                validate_midi(job_dir / result['folder'] / 'notes.mid')
                self.assertEqual(client.put(f'/api/jobs/{job_id}/lyrics', json={"text": "[99:00]Too late"}).status_code, 400)
                self.assertEqual(client.get(f'/api/jobs/{job_id}/files/result.json').status_code, 404)
                self.assertEqual(client.post('/api/jobs', headers={'Origin': 'https://example.com'}).status_code, 403)
                self.assertEqual(client.post('/api/jobs', files={'audio': ('bad.exe', b'fake')}).status_code, 400)
                self.assertEqual(client.post('/api/jobs', files={'audio': ('test.mp3', b'fake')}, data={'bpm':'nan'}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
