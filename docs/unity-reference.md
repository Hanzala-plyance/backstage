# Unity reference (retired)

Canonical product and feature context: [backstage-specs/meta](https://github.com/Hanzala-plyance/backstage-specs/tree/meta).

The Unity fork is no longer on develop. Check out tag `unity-reference` to use the
instructions in the Game section below; the remaining sections still apply.

## Game

At tag `unity-reference`, initialize submodules, pull LFS assets, then open `Backstage/` in Unity 6000.3.5f2.
Let the package manager restore dependencies and resolve editor errors before
building. Use Unity's Build Profiles to build a standalone player named Backstage.
Place a macOS build in `Backstage/Builds/Backstage.app` or `/Applications/Backstage.app`,
or set `BACKSTAGE_GAME_PATH` to a built application/executable. Generated builds
stay local. The root launcher passes the shared Songs path to the process.

Unity was unavailable during initial integration. No Unity build or gameplay pass
is claimed. Keep the candidate on develop until the editor build and a real song
playback pass are recorded. Internal YARG namespaces/GUIDs are retained; public
branding, product/app identity, logo assets, and staff entry are Backstage.

## Song preparation

Run `python3 scripts/setup.py`, then `python3 "Add New Song/start.py"`.
FFmpeg/FFprobe are required; optional browser artwork uses Playwright Chromium.
Search/YouTube acquisition needs network access, while uploaded audio can be
prepared locally with lyrics/artwork network options turned off. A first speech
model download may require connectivity. Music licensing is a separate catalog gate.

Choose audio or search/add a batch, queue, and wait for **Installed in Backstage**.
The service validates metadata, decodable audio, and playable MIDI difficulties,
copies outside the scan root, then renames a complete directory into Songs.
An install failure leaves the export intact and retryable. Run **Scan Songs** from
the game library to discover it. Re-convert to publish a different immutable
snapshot; editor changes do not silently modify an in-use installed song.

## Controllers (macOS)

```bash
cd mac-riff/build
npm ci
bash build-setup.sh
```

Open `Backstage Controllers.app`, select **Backstage**, and choose native guitars,
gamepads, or MIDI drums. Build/copy Backstage.app to Applications for discovery.
The existing Xbox Riffmaster bridge is specific to Clone Hero and remains rejected
for Backstage. Native device detection is not proof of every input working: verify
frets, both strum directions, whammy, and other supported controls physically.
Do not run privileged recovery/injection as a generic CI or smoke test.

## Automated checks

```bash
BACKSTAGE_SONGS_DIR=/tmp/backstage-test-songs PYTHONPATH=song-converter \
  .venv/bin/python -m unittest discover -s song-converter/tests -p 'test_*.py'
node --test mac-riff/build/tests/*.test.js
python3 -m unittest discover -s scripts -p 'test_promotion.py'
# macOS source typecheck:
swiftc -typecheck mac-riff/build/setup-model.swift mac-riff/build/setup.swift
```

Desktop release gates are described in [development.md](development.md). Before main, verify a converted song in the game, supported physical controllers,
clean installation, restart/disconnect recovery, and rollback. Record the tested
commit; promotion checks reject subsequent executable/asset changes. The report
starts blocked and must not be changed to passed without those checks.
