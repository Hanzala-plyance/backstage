import json
from pathlib import Path
import unittest

from songmaker.names import clean_song, folder_name

CASES = json.loads((Path(__file__).resolve().parents[2] / 'desktop' / 'tests' / 'fixtures' / 'song-names.json')
                   .read_text(encoding='utf-8'))


class NameTests(unittest.TestCase):
    def test_matches_desktop_cleanup(self):
        for (title, artist), (want_title, want_artist) in CASES['clean']:
            with self.subTest(title=title, artist=artist):
                self.assertEqual(clean_song(title, artist), (want_title, want_artist))

    def test_matches_desktop_folder_names(self):
        for (title, artist), want in CASES['folder']:
            self.assertEqual(folder_name(title, artist), want)
        self.assertLessEqual(len(folder_name('x' * 300, '')), 120)


if __name__ == '__main__': unittest.main()
