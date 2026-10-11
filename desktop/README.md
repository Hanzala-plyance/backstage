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
**Quickplay** or **Soundcheck** from the main menu. Menus work with a guitar or
gamepad: strum to move, green to select, red to go back, yellow to switch section,
Start to pause; the hint bar shows the buttons.

New players start in **Soundcheck**. **Start Soundcheck** runs every step in order:
a **controller check** (press every fret, strum, Star Power, whammy and, on a pad,
Start; each tile lights when Backstage hears it), then six short, forgiving
lessons (frets & strum, chords, sustains, HOPOs & taps, Star Power, streaks &
multiplier). Each lesson explains the skill with your own controls, plays a demo in
which the game performs the chart on the real highway with cues for every note,
then gives you a turn graded against a goal. Progress is remembered on this
computer. The last step starts the full Soundcheck track on Easy; it is not listed
among library songs. Lessons use the
Controllers selection (a MIDI kit falls back to the keyboard). The Soundcheck
backing is synthesized locally, works offline, and needs no downloaded music. Hold **A S D F G** for green/red/yellow/blue/orange and strum with
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

### Library

**Avatars** (main menu or sidebar) sets a name and look for each of the four
players. Names are up to 8 letters or numbers and replace P1–P4 in the song dialog
and on stage. Pick one of 10 premade avatars, or **Use my camera**: raise a hand
(motion in the dashed upper corners starts a 3-2-1 countdown) or press **Take
photo**; the photo is restyled in the stage colours. Camera avatars can't be
customized, and photos stay on this computer (`band.json` in the app's data
folder). Only video is requested; the microphone is never used.

In game the band performs in 3D on the stage behind the highway, in the
spotlights: chibi performers drawn comic-book style (toon shading, halftone
shadows, ink outlines, off-register colour), posed 30 times a second. The stage
is cheap because it renders only at those poses, on its own small canvas, and one
shared stage holds every player. Arms
have elbows and reach for real targets: the fretting hand moves to the fret for the
note just hit and the strumming hand alternates down and up strokes; drummers hit
the piece that matches the note (snare, hi-hat, toms, cymbals, kick pedal). They
groove to the tempo, shake their head with dizzy eyes on a miss, head-bang on a 10+
streak, and raise the guitar with star eyes and an aura in Star Power. In single
player the performer stands left or right of the highway.

Each player also picks **gear**: a guitar shape (Classic S, Classic T, Single Cut,
Double Cut, Arrow; generic names, as brand and model names are trademarks), a
finish colour, a drum kit (Rock, Compact, Double Kick, Electronic) and which side
of the highway they stand on. Comic captions ("YEAH!", "OOF!", "SUPER STAR!") pop over
the performer. If 3D can't start, the game plays on without the band.

Hover or move onto a song (mouse, arrow keys or strum) to hear a short looping
preview, starting at the song's `preview_start_time` when it has one. To remove a
song, open it and choose **Remove from library**, or press **blue** / **Delete** on a
song in the list, then confirm. The song folder moves to the Trash, so it can be
restored. Songs leave the Preparation queue once
they are installed in the library.

Song titles are shown without YouTube decorations ("(Official Video)", channel names
as artists), without rewriting `song.ini`. Backstage stores converted songs in
`Artist - Title` folders and renames older job-ID folders the same way; folders you
named yourself are left alone. For songs with a generated or missing cover, the app
looks up the iTunes catalog once (sending the artist and title to Apple) and uses a
cover only when artist and title match; **Find cover online** in the song dialog
retries. Fetched covers are copyrighted artwork for personal use.

### Song details, scores and stars

Hover or move onto a song to see its details beside the list (Clone Hero style):
a large cover, album, year, genre, charter and length, and for each instrument its
intensity, the difficulties it has (E/M/H/X) and your best result. Finishing a song
saves each player's best score for that song, instrument and difficulty on this
computer. Stars run from 0 to 5, with a gold sixth, based on YARG's thresholds
relative to a full combo at 1×. Results show the stars and **New best**.

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

### Players: press Start to join

A bar along the bottom of the main menu and every page shows Players 1–4, Clone
Hero style. A controller that connects while Player 1 is on the keyboard becomes
Player 1. Any other controller joins as the next player by pressing **Start**.
Its setup pop-up opens above the bar and only that controller drives it: strum to
move, green to change (yellow goes back), red or Start to close. It has a live
fret and strum test, the player's **avatar** (the 10 premade looks, or their camera
photo), **instrument**, **difficulty**, **strumming** (on: strum to hit notes;
off: frets alone, for that player only; it starts from the Settings choice) and
**Leave**. Start on a player's own
controller reopens it; the mouse works too. The Avatars section edits the same
players (names, camera photos, gear). Choosing a song keeps each player's choices
where the song has those charts. During a song, a controller nobody is playing
says so instead of being ignored.

### PDP Riffmaster for Xbox

macOS has no driver for the Riffmaster's USB receiver, so it never shows up as a
gamepad on its own. Backstage reads the receivers itself (`electron/riff/`, with
the Xbox GIP handling adapted from MacRiff in `mac-riff/`): no separate program or
command. Receivers connect automatically when Backstage starts or one is plugged
in, and reconnect after a replug. Each appears as its own controller, "PDP
Riffmaster 1 (Xbox)", "2", and so on, with a built-in guitar mapping: frets,
strum, Start, Select or tilt for Star Power, and whammy. Choose them like any
gamepad, for any of up to four players. **Controllers → PDP Riffmaster (Xbox)**
shows each receiver's state; **Disconnect** releases them for other apps.

If MacRiff is running it holds the receivers: stop its session or quit MacRiff
Setup, then click **Connect Riffmasters**. If macOS still won't let Backstage open
a receiver, **Use administrator access** runs the same reader with one password
prompt; it stops and releases USB when you disconnect or quit Backstage.

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
