"""Publish immutable, validated conversion snapshots to Backstage's scan root."""
from configparser import ConfigParser
from pathlib import Path
from threading import Lock
import json
import os
import re
import shutil
import tempfile

from .names import clean_song, folder_name

_publish_lock = Lock()
_FILES = {'song.ini', 'notes.mid', 'notes.chart', 'song.ogg', 'song.opus',
          'song.mp3', 'song.wav', 'album.png', 'album.jpg', 'video.mp4', 'lyrics.lrc'}


def songs_root() -> Path:
    configured = os.environ.get('BACKSTAGE_SONGS_DIR', '').strip()
    return Path(configured).expanduser().resolve() if configured else Path.home() / 'Music' / 'Backstage' / 'Songs'


def validate_song(folder: Path) -> None:
    """Check real chart/audio content before exposing a folder to the game scanner."""
    from mido import MidiFile
    from .midi import validate_midi, MIDI_NAMES
    import soundfile as sf
    ini = ConfigParser(interpolation=None, strict=False)
    ini.read(folder / 'song.ini', encoding='utf-8-sig')
    if not ini.has_section('song') or not ini.get('song', 'name', fallback='').strip():
        raise ValueError('The export needs a song.ini with a song name.')
    audio = next((folder / name for name in ('song.ogg', 'song.opus', 'song.mp3', 'song.wav')
                  if (folder / name).is_file()), None)
    if not audio or sf.info(audio).duration <= 0:
        raise ValueError('The export has no readable song audio.')
    if (folder / 'notes.mid').is_file():
        midi = MidiFile(folder / 'notes.mid')
        instruments = tuple(key for key, name in MIDI_NAMES.items()
                            if any(track.name == name for track in midi.tracks))
        if not instruments:
            raise ValueError('The MIDI chart contains no supported instrument tracks.')
        validate_midi(folder / 'notes.mid', instruments)
    elif (folder / 'notes.chart').is_file():
        text = (folder / 'notes.chart').read_text(encoding='utf-8-sig')
        if not re.search(r'\[\w*(Single|DoubleBass|Drums)\]', text) or not re.search(r'\d+\s*=\s*N\s+\d+', text):
            raise ValueError('The chart contains no recognized playable notes.')
    else:
        raise ValueError('The export needs notes.mid or notes.chart.')


def installed_folder(root: Path, job_id: str) -> Path | None:
    """Find a job's installed song by the ID recorded inside it, so folders
    renamed to readable names (or legacy job-ID names) stay recognised."""
    if not root.is_dir():
        return None
    for folder in root.iterdir():
        marker = folder / '.backstage.json'
        if folder.is_symlink() or not folder.is_dir() or not marker.is_file():
            continue
        try:
            if json.loads(marker.read_text(encoding='utf-8')).get('job_id') == job_id:
                return folder
        except (OSError, ValueError):
            continue
    return None


def _free_folder(root: Path, title: str, artist: str) -> Path:
    base = folder_name(*clean_song(title, artist))
    destination, n = root / base, 2
    while destination.exists() or destination.is_symlink():
        destination, n = root / f'{base} ({n})', n + 1
    return destination


def publish(job_dir: Path) -> dict:
    """Install once per job; retries return the same complete snapshot.

    Edits to a converted export do not silently change a song currently in use.
    Re-convert edited source as a new job to install another immutable snapshot.
    """
    if not re.fullmatch(r'[a-f0-9]{32}', job_dir.name):
        raise ValueError('Invalid conversion ID.')
    result = json.loads((job_dir / 'result.json').read_text(encoding='utf-8'))
    name = result.get('folder', '')
    if not name or Path(name).name != name or name in ('.', '..'):
        raise ValueError('Invalid conversion folder.')
    source = job_dir / name
    if source.is_symlink() or not source.is_dir():
        raise ValueError('The completed conversion folder is unavailable.')
    if any(path.is_symlink() for path in source.iterdir()):
        raise ValueError('Song exports cannot contain symbolic links.')
    root = songs_root()
    with _publish_lock:
        root.mkdir(parents=True, exist_ok=True)
        destination = installed_folder(root, job_dir.name)
        if destination:
            validate_song(destination)
        else:
            # Readable "Artist - Title"; an existing folder is never reused.
            destination = _free_folder(root, result['metadata'].get('title', ''),
                                       result['metadata'].get('artist', ''))
            staging_root = root.parent / '.backstage-imports'
            staging_root.mkdir(parents=True, exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix=job_dir.name + '-', dir=staging_root))
            try:
                for path in source.iterdir():
                    if path.name in _FILES and path.is_file():
                        shutil.copy2(path, staging / path.name)
                validate_song(staging)
                (staging / '.backstage.json').write_text(json.dumps({
                    'job_id': job_dir.name, 'title': result['metadata']['title'],
                    'artist': result['metadata']['artist'], 'format': 1,
                }), encoding='utf-8')
                # Same filesystem: the scanner sees either nothing or a complete song.
                staging.rename(destination)
            finally:
                if staging.exists():
                    shutil.rmtree(staging)
        receipt = {'status': 'installed', 'path': str(destination),
                   'message': 'Installed in Backstage. Use Scan Songs in the game to refresh.',
                   'snapshot': 'Immutable conversion snapshot; later editor changes affect the export only.'}
        temporary = job_dir / 'library.tmp.json'
        temporary.write_text(json.dumps(receipt), encoding='utf-8')
        temporary.replace(job_dir / 'library.json')
    return receipt


def install_status(job_dir: Path) -> dict:
    path = job_dir / 'library.json'
    if not path.is_file():
        return {'status': 'not-installed', 'message': 'Conversion export has not been installed in Backstage.'}
    result = json.loads(path.read_text(encoding='utf-8'))
    if result.get('status') == 'installed' and not Path(result['path']).is_dir():
        moved = installed_folder(songs_root(), job_dir.name)
        if moved:
            return {**result, 'path': str(moved)}
        return {'status': 'missing', 'message': 'The installed song folder is missing. Retry installation.'}
    return result
