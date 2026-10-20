"""Check standalone testing with the installed app; no game or USB access needed."""
import json
import os
import socket
import struct
import subprocess
import tempfile
import time
from pathlib import Path

runtime = Path('/Applications/MacRiff Setup.app/Contents/Resources/Runtime')
with tempfile.TemporaryDirectory(prefix='mrf-host-', dir='/tmp') as directory:
    root = Path(directory)
    env = dict(os.environ, MACRIFF_CONTROLLER_SOCKET=str(root / 'controller.sock'),
               DYLD_INSERT_LIBRARIES=str(runtime / 'build/libMacRiffController.dylib'))
    with (root / 'test.log').open('w') as log:
        host = subprocess.Popen([str(runtime / 'build/controller-test-host')], env=env,
                                stdout=log, stderr=log)
        def wait_for(check):
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                result = check()
                if result:
                    return result
                time.sleep(.025)
            raise AssertionError('Timed out waiting for standalone test state')
        def status():
            try:
                return json.loads((root / 'status.json').read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                return {}
        try:
            wait_for(lambda: (root / 'controller.sock').exists())
            with socket.socket(socket.AF_UNIX) as client:
                client.connect(str(root / 'controller.sock'))
                # All frets, up-strum, analog extremes, click and menu buttons.
                frame = struct.pack('<4sBBBBBBhhBB', b'MRF2', 12, 1, 255, 255, 31, 1, -32768, 32767, 0, 0)
                client.sendall(frame[:3]); client.sendall(frame[3:])
                first = wait_for(lambda: (s := status()).get('reports', 0) >= 1 and s)
                assert first['frets'] == [True] * 5
                assert first['whammy'] == 1 and first['stickX'] == -1 and first['stickY'] == 1
                assert first['gameDetected'] is False, 'Tester must not need a game'
                assert first['observed'] & 127 == 63, 'Down strum has not been tested yet'
                client.sendall(struct.pack('<4sBBBBBBhhBB', b'MRF2', 0, 2, 0, 0, 0, 0, 0, 0, 0, 0))
                final = wait_for(lambda: (s := status()).get('reports', 0) >= 2 and s)
                assert final['observed'] & 127 == 127, 'All required controls observed'
            released = wait_for(lambda: (s := status()).get('connected') is False and s)
            assert released['frets'] == [False] * 5
            assert released['whammy'] == released['tilt'] == released['stickX'] == released['stickY'] == 0
            print('PASS: standalone input, fragmented frames, pre-play checklist, and disconnect release without a game')
        finally:
            host.terminate()
            host.wait(timeout=5)
