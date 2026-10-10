# Backstage desktop

A native desktop application built with Electron, React, TypeScript, Vite, Three.js
and browser audio. Canonical planning and release policy:
[backstage-specs/meta](https://github.com/Hanzala-plyance/backstage-specs/tree/meta).
Feature: `web-desktop-foundation`. This is a development build, not a qualified venue release.

## Run

From the repository root:

```bash
npm --prefix desktop ci
npm --prefix desktop run build
npm --prefix desktop start
```

For rapid UI development use `npm --prefix desktop run dev`. If your npm configuration
skips dependency install scripts, run `node desktop/node_modules/electron/install.js`
once to download Electron. Development requires Node 22.22+.

Build a native bundle with `npm --prefix desktop run package`. On this Apple Silicon
Mac the output is `desktop/release/Backstage-darwin-arm64/Backstage.app`. Double-click
**Start Backstage.command** at the repository root to open the packaged application
with this checkout's preparation environment. No Unity editor is required.

## Play

The app opens on a title screen: press **Start** (or green / Enter), then pick
**Quickplay** or **Practice** from the main menu. Menus work with a guitar or gamepad:
strum to move, green to select, red to go back, yellow to switch section, Start to
pause; the hint bar shows the buttons. Start with **Practice → Take the stage →
Start playing**. The included
Soundcheck backing is synthesized locally, works offline, and needs no downloaded
music. Hold **A S D F G** for green/red/yellow/blue/orange and strum with
**Space / ↑ / ↓**. **Shift** activates Star Power; **W** whammies held Star Power
sustains. In Settings, **Tap assist / drums** lets you hit gems with fret keys alone.
Escape pauses. Focus loss and loss of the
selected gamepad/MIDI device pause playback; resume is explicit.

The app reads `~/Music/Backstage/Songs`, overridden by `BACKSTAGE_SONGS_DIR` or
Settings → Choose folder. It loads `song.ini`, five-lane `notes.mid`, and `song.ogg`,
`song.opus`, `song.mp3` or `song.wav`. Guitar, bass, rhythm and drums use MIDI note
ranges 60–64 / 72–76 / 84–88 / 96–100. Tempo changes are preserved. Unsupported or
invalid folders show a warning. `.chart`, split stems, six-fret and vocals are not
implemented yet.

### Local multiplayer

Up to four players can play one song together. In the track dialog choose
**＋ Add player**; each player gets their own controller (keyboard, a connected
gamepad/guitar, or MIDI drums), instrument and difficulty, and no controller can be
used by two players. Each player has their own highway, streak, multiplier, Star Power
and score; results show every player and the band total. Any player's Start pauses
the song, and a disconnected controller pauses it and names that player. Player 1 is
the device selected in Controllers.

### Five-fret guitar

Solid circular gems require strumming. White caps are HOPOs: change frets or pull
off to the lower fret while maintaining a streak. Dark inset caps are taps, which
can restart a broken streak without strumming. Lower frets can anchor a single
note; ordinary strum chords require exactly their frets. Open notes require no
held frets. Short strum/fret and post-HOPO strum grace accommodates input ordering.

Every gem is worth 50 points; timing grades are feedback, not different point
values. Streaks increase the multiplier at 10/20/30 chords, to 2x/3x/4x. Sustains
score 25 points per quarter-note beat, with tempo changes, disjoint tails and
extended holds. A released tail drops after a 60 ms grace period and cannot resume.
Completed solo sections award a percentage-based bonus.

Complete glowing phrases to earn a quarter meter of Star Power. Half a meter
allows activation; Star Power **doubles your multiplier, up to 8x**, without
speeding up the song. A full meter lasts eight musical measures. Phrase awards
and whammy can refill it during activation. Gamepad Star Power (including a tilt
axis) and whammy are remappable in Controllers. Soundcheck includes phrases on
Easy and HOPO/tap/sustain examples on Expert.

Supported MIDI markers: natural/forced HOPOs, forced strums, tap note 104 and Phase
Shift tap SysEx, enhanced/Phase Shift open notes, Star Power 116 and solo 103.
This is a source-informed guitar implementation, not full YARG parity. Advanced
trill/tremolo lane forgiveness, big rock endings, mixed open/fretted chords,
engine presets/dynamic windows, song-speed practice and exact sustain-burst
rounding remain tracked work. Physical guitar timing still needs acceptance.

## Search and prepare songs

**Add new songs** searches YouTube audio or community charts on Chorus Encore.
Queue YouTube results or paste an individual video URL. **Add audio file** queues
local recordings. Charts from Chorus open at the provider for manual download;
place compatible extracted songs in the shared library. Refresh the library after
conversion. Queue rows show conversion and installation errors separately and offer
installation retry. History remains visible after restart without starting Python.

Preparation uses the existing Python converter and FFmpeg. On a fresh checkout:

```bash
python3 scripts/setup.py
```

The development launcher discovers the repository `.venv`. A standalone installed
app uses its saved Python selection, `BACKSTAGE_PYTHON`, or Settings → Choose Python
environment (select `.venv/bin/python` on macOS). Dependencies are not bundled in
Electron. FFmpeg must be on PATH; common Homebrew locations are included on macOS.
Search and conversion start the service lazily; installed songs remain playable
without it. Video downloads, lyrics transcription and online artwork are disabled
for desktop queue jobs. Advanced preparation opens the existing local tool.

The optional environment can be large; it includes upstream converter dependencies.
No Python environment, speech model, Unity asset tree or user songs are shipped in
the desktop package. Writable conversion output, cache and logs live beneath the
app's user-data directory, never inside the application bundle. Closing during
preparation warns that incomplete conversions must be queued again. Use authorized
music; conversion is independent of commercial catalog clearance.

## Controllers

Open **Controllers**, connect or pair your input and press a button. Select its
entry, click an action and press a button or move an axis. Mappings and axis
thresholds persist per device identity. The live monitor shows actual browser
button/axis values. Default mappings are starting points, not model certifications.

Keyboard works without setup. **Connect MIDI drums** requests non-SysEx MIDI access;
select an input and use General MIDI drum mapping or teach individual pads. Select
the Drums track for MIDI play. Gamepad APIs depend on OS drivers: Xbox, PlayStation,
Switch-style, generic pads and guitars work only when Chromium exposes usable
controls. No claim is made that every controller works. The existing MacRiff Xbox
Riffmaster USB bridge injects into Clone Hero and is not used by this runtime.
Physical hardware and audible timing acceptance remain required before main.

## Maintain and verify

- `src/core/`: audio, judgment and input normalization.
- `src/game/`: lazy-loaded Three.js highway and game session.
- `src/App.tsx`, `src/Controllers.tsx`: application and controller screens.
- `electron/`: sandboxed shell, narrow validated IPC, library access and preparation lifecycle.
- `scripts/package.mjs`: native packaging; bundled renderer dependencies are excluded from Node payload.

```bash
npm --prefix desktop test
npm --prefix desktop run build
npm --prefix desktop run test:app
# Optional real local converter integration, from desktop/:
node scripts/service-smoke.mjs
# Include live provider queries without downloading their music:
BACKSTAGE_TEST_ONLINE=1 node scripts/service-smoke.mjs
```

The app smoke uses real Electron/audio plus simulated gamepad input. It is not
physical controller evidence. Packaging is locally ad-hoc signed on macOS; public
notarized distribution and clean-machine acceptance are separate release tasks.
App payload was approximately 2.4 MB and total Apple Silicon bundle approximately
291 MB during the initial build. These are disk sizes, not runtime RAM measurements.
