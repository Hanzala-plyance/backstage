#!/usr/bin/env python3
"""Launch an explicitly installed Backstage build with the shared library contract."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if __name__ == '__main__':
    configured = os.environ.get('BACKSTAGE_GAME_PATH')
    candidates = [Path(configured).expanduser()] if configured else [
        ROOT / 'Backstage/Builds/Backstage.app', Path('/Applications/Backstage.app'),
        ROOT / 'Backstage/Builds/Backstage.exe', ROOT / 'Backstage/Builds/Backstage.x86_64',
    ]
    game = next((p for p in candidates if p.exists()), None)
    if not game:
        raise SystemExit('Backstage game build not found. Build Backstage/ with Unity 6000.3.5f2 or set BACKSTAGE_GAME_PATH. See docs/development.md.')
    songs = Path(os.environ.get('BACKSTAGE_SONGS_DIR', str(Path.home() / 'Music/Backstage/Songs'))).expanduser().resolve()
    songs.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'BACKSTAGE_SONGS_DIR': str(songs)}
    if game.suffix == '.app':
        import plistlib
        with (game / 'Contents/Info.plist').open('rb') as handle:
            executable = plistlib.load(handle)['CFBundleExecutable']
        game = game / 'Contents/MacOS' / executable
    raise SystemExit(subprocess.call([str(game)], env=env))
