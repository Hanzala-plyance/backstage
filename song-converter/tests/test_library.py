import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import mido
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
from songmaker import library, server


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.output = self.root / 'output'
        self.job = self.output / ('a' * 32)
        self.folder = self.job / 'Artist - Song'
        self.folder.mkdir(parents=True)
        (self.folder / 'song.ini').write_text('[song]\nname = Song\nartist = Artist\n')
        sf.write(self.folder / 'song.ogg', np.sin(np.arange(22050) * .1), 22050, format='OGG', subtype='VORBIS')
        midi = mido.MidiFile()
        track = mido.MidiTrack([mido.MetaMessage('track_name', name='PART GUITAR')])
        for pitch in (60, 72, 84, 96):
            track.append(mido.Message('note_on', note=pitch, velocity=100, time=0))
            track.append(mido.Message('note_off', note=pitch, time=100))
        midi.tracks.append(track)
        midi.save(self.folder / 'notes.mid')
        (self.job / 'result.json').write_text(json.dumps({'folder': self.folder.name, 'metadata': {'title': 'Song', 'artist': 'Artist'}}))
        self.songs = self.root / 'Songs'
        self.env = patch.dict(os.environ, {'BACKSTAGE_SONGS_DIR': str(self.songs)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.temp.cleanup)

    def test_publish_is_complete_idempotent_and_survives_restart(self):
        receipt = library.publish(self.job)
        installed = Path(receipt['path'])
        self.assertTrue((installed / 'notes.mid').is_file())
        self.assertTrue((installed / 'song.ogg').is_file())
        self.assertEqual(library.publish(self.job), receipt)
        self.assertEqual(len(list(self.songs.iterdir())), 1)
        with patch.object(server, 'OUTPUT', self.output), patch.object(server, 'jobs', {}):
            client = TestClient(server.app)
            self.assertEqual(client.get('/api/jobs/' + self.job.name).json()['library']['status'], 'installed')
            self.assertEqual(len(client.get('/api/library').json()['songs']), 1)
            self.assertEqual(client.post('/api/jobs/' + self.job.name + '/install').status_code, 200)

    def test_invalid_chart_never_becomes_visible(self):
        (self.folder / 'notes.mid').write_bytes(b'not a midi file')
        with self.assertRaises(Exception):
            library.publish(self.job)
        self.assertEqual(list(self.songs.iterdir()), [])
        self.assertEqual(list((self.root / '.backstage-imports').iterdir()), [])

    def test_failed_copy_cannot_publish_partial_song_and_retry_works(self):
        with patch.object(library.shutil, 'copy2', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                library.publish(self.job)
        self.assertEqual(list(self.songs.iterdir()), [])
        self.assertEqual(library.publish(self.job)['status'], 'installed')

    def test_rejects_traversal_symlinks_and_unrelated_destination(self):
        result = json.loads((self.job / 'result.json').read_text())
        (self.job / 'result.json').write_text(json.dumps({**result, 'folder': '../outside'}))
        with self.assertRaises(ValueError): library.publish(self.job)
        (self.job / 'result.json').write_text(json.dumps(result))
        (self.folder / 'video.mp4').symlink_to(self.root / 'outside')
        with self.assertRaises(ValueError): library.publish(self.job)
        (self.folder / 'video.mp4').unlink()
        (self.songs / self.job.name).mkdir(parents=True)
        (self.songs / self.job.name / 'keep.txt').write_text('existing')
        with self.assertRaises(ValueError): library.publish(self.job)
        self.assertEqual((self.songs / self.job.name / 'keep.txt').read_text(), 'existing')

    def test_conversion_success_with_install_failure_keeps_export_retryable(self):
        with patch.object(server, 'OUTPUT', self.output), patch.object(server, 'jobs', {}), \
             patch.object(server, 'convert'), patch.object(server, 'publish', side_effect=OSError('readonly')), \
             patch('logging.exception'):
            server.run_job(self.job.name, None, {})
            self.assertEqual(server.jobs[self.job.name]['status'], 'complete')
            self.assertEqual(library.install_status(self.job)['status'], 'error')
        self.assertTrue((self.job / 'result.json').exists())
        self.assertEqual(library.publish(self.job)['status'], 'installed')

    def test_successful_conversion_installs_automatically(self):
        with patch.object(server, 'OUTPUT', self.output), patch.object(server, 'jobs', {}), patch.object(server, 'convert'):
            server.run_job(self.job.name, None, {})
            self.assertEqual(server.job_status(self.job.name)['library']['status'], 'installed')

    def test_snapshot_does_not_silently_change_while_game_may_use_it(self):
        receipt = library.publish(self.job)
        (self.folder / 'song.ini').write_text('[song]\nname = Edited\n')
        library.publish(self.job)
        self.assertIn('name = Song', (Path(receipt['path']) / 'song.ini').read_text())


if __name__ == '__main__': unittest.main()
