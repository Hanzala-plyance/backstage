#!/usr/bin/env python3
"""Start Backstage's local song preparation service using the project environment."""
from pathlib import Path
import json
import os
import subprocess
import sys
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]

if __name__ == '__main__':
    try:
        with urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=2) as response:
            health = json.load(response)
        if health.get('product') != 'Backstage':
            raise SystemExit('Port 8765 is used by another app. Stop it before starting Backstage.')
        webbrowser.open('http://127.0.0.1:8765')
    except (OSError, ValueError):
        python = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        if not python.is_file():
            raise SystemExit('Run scripts/setup.py from the repository first to install the local environment.')
        raise SystemExit(subprocess.call([str(python), str(ROOT / 'song-converter/run.py')]))
