#!/usr/bin/env python3
"""Install Backstage's staff preparation environment; never change system settings."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]
if __name__ == '__main__':
    if sys.version_info < (3, 11):
        raise SystemExit('Python 3.11 or newer is required.')
    venv.EnvBuilder(with_pip=True).create(ROOT / '.venv')
    python = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'song-converter/requirements.txt')], check=True)
    print('Ready: python "Add New Song/start.py"')
    if not shutil.which('ffmpeg'):
        print('FFmpeg is still required for conversion. Install FFmpeg and FFprobe before queuing songs.')
    print('Optional browser artwork: run the local Python with -m playwright install chromium.')
