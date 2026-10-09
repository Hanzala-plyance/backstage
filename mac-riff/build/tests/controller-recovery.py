"""Real native adapter: idle heartbeats, stuck-input release, independent recovery."""
import json, os, socket, struct, subprocess, sys, tempfile, time
from pathlib import Path
runtime = Path(sys.argv[1] if len(sys.argv) > 1 else '/Applications/MacRiff Setup.app/Contents/Resources/Runtime')
with tempfile.TemporaryDirectory(prefix='mrf-recovery-', dir='/tmp') as directory:
    root = Path(directory)
    for n in (1,2): (root / f'p{n}').mkdir()
    config = root / 'controllers.json'
    config.write_text(json.dumps([dict(name=f'MacRiff Player {n}', socket=str(root/f'p{n}/c')) for n in (1,2)]))
    env = dict(os.environ, MACRIFF_CONTROLLER_CONFIG=str(config), DYLD_INSERT_LIBRARIES=str(runtime/'build/libMacRiffController.dylib'))
    heartbeat = b'MRFH' + bytes(12)
    def frame(frets): return struct.pack('<4sBBBBBBhhBB', b'MRF2', 0,0,0,0,frets,0,0,0,0,0)
    def state(n):
        try: return json.loads((root/f'p{n}/status.json').read_text())
        except (FileNotFoundError, json.JSONDecodeError): return {}
    def wait(check, pulse=None):
        end = time.monotonic() + 6
        while time.monotonic() < end:
            if pulse: pulse()
            if check(): return
            time.sleep(.1)
        raise AssertionError('Timed out waiting for recovery state')
    with (root/'host.log').open('w') as log:
        host = subprocess.Popen([str(runtime/'build/controller-test-host')], env=env, stdout=log, stderr=log)
        clients = []
        try:
            wait(lambda: all((root/f'p{n}/c').exists() for n in (1,2)))
            for n in (1,2):
                c = socket.socket(socket.AF_UNIX); c.connect(str(root/f'p{n}/c')); clients.append(c); c.sendall(frame(n))
            wait(lambda: state(1).get('connected') and state(2).get('connected'))
            # No new USB reports: idle/held inputs must survive heartbeat-only traffic.
            for _ in range(40):
                for c in clients: c.sendall(heartbeat)
                time.sleep(.1)
            assert state(1)['frets'] == [True,False,False,False,False]
            assert state(1)['reports'] == 1, 'Heartbeats must not replay input edges'
            assert state(2)['reports'] == 1
            # Leave socket 1 open but silent, as if its reader froze.
            wait(lambda: state(1).get('connected') is False, lambda: clients[1].sendall(heartbeat))
            assert state(1)['frets'] == [False]*5, 'Watchdog must release held notes'
            assert state(2)['connected'] and state(2)['frets'][1], 'Other player must remain playable'
            clients[0].close()
            clients[0] = socket.socket(socket.AF_UNIX); clients[0].connect(str(root/'p1/c'))
            clients[0].sendall(frame(4))
            wait(lambda: state(1).get('reports') == 2, lambda: clients[1].sendall(heartbeat))
            assert state(1)['connected'] and state(1)['frets'][2]
            assert state(1)['observed'] & 5 == 5, 'The same slot must retain test history'
            print('PASS: idle heartbeat, stalled-reader release, isolated player recovery and retained slot history')
        finally:
            for c in clients: c.close()
            host.terminate(); host.wait(timeout=5)
