# MacRiff — mixed controllers and saved setups

Open **MacRiff Setup** in Applications. Start with one player; click **Add Player**
to show another, up to four. **Remove Player** removes the last added slot.
Saved setups remember their visible players and preserve existing device choices.
Each player chooses a physical device, an instrument profile, and a connection
route. Use **Save a copy…** for combinations such as Solo, Guitars + Drums, or
Four Players. Changes save automatically in
`~/Library/Application Support/MacRiff/setups.json`.

## Connection routes

| Route | What MacRiff does |
| --- | --- |
| Native controller | Opens the game and leaves the controller and its existing mappings alone. No emulation, USB claiming, or administrator prompt. |
| Native MIDI drums | Lists macOS MIDI inputs. Use the selected game's MIDI mapper for pads, cymbals, kick and velocity thresholds. MacRiff does not convert the kit into a guitar. |
| Xbox Riffmaster bridge | Reads that receiver, exposes one separate virtual guitar, and supplies the Riffmaster defaults for that player. |

Your working Xbox and PS3 controllers should use **Automatic** (native for HID
controllers), or **Native (already works)**. Choose **Drums**, **Gamepad**, or
**5-fret guitar** for each player. These are saved setup choices; select the
matching instrument and player profile inside the game as well. MacRiff does
not rewrite native game bindings, MIDI note maps, or game player profiles.

Automatic routing currently recognizes the Xbox PDP Riffmaster (`0e6f:0248`)
as bridge hardware. The Native override allows a controller that already works
in your particular game/version to bypass that bridge too. Unknown hardware
is not sent another device's initialization commands.

## Start a session

1. Plug in USB controllers/receivers and power on the instruments. Pair Bluetooth
   controllers through macOS. Pair wireless guitars with their original receivers.
2. Open MacRiff Setup and select a saved setup, or choose devices for Players 1–4.
   Set unused players to **Not playing**. One physical device belongs to one slot.
3. Choose each slot's instrument and route. A saved but disconnected device
   stays visible as disconnected; MacRiff does not silently substitute another.
4. If every device is native, click **Play Clone Hero** or **Play YARG**. This
   opens the original game. MacRiff does not inject its controller adapter.
5. If any player needs the Riffmaster bridge, choose Clone Hero, then click
   **Connect & Test Bridges**. Approve the macOS USB dialog for those receivers.
   Native players are not claimed or emulated.
6. Use the **Inspect** selector to test each bridged player: press all five frets
   and strum up and down. Checkmarks stay after release. Whammy, tilt, both fret
   rows, joystick and menu buttons can also be checked. The game stays closed.
7. When all bridged guitars pass the required checks, click **Play Clone Hero**.
   Test readers release USB before game readers start. A USB dialog may appear
   again. The game sees separate controllers: **MacRiff Riffmaster** for Player 1,
   and **MacRiff Riffmaster P2/P3/P4** for the other bridge slots.
8. In Clone Hero press Space and assign each controller to its intended player.
   Select each player's game profile/instrument. For normal guitar play, use
   5-fret guitar with Gamepad Mode and All Taps off. For drums, select Drums and
   configure the kit in the game's drum/MIDI controls. Check a practice song.

Native and bridged controllers can share a session. Native devices keep their
original identities; only bridge slots create virtual controllers. Slot choices
do not guarantee the game automatically assigns that same player number; verify
assignment in the game's controls menu.

## Multiple receivers and reconnection

Each Riffmaster needs its original receiver. MacRiff selects receivers by USB
bus/port path, rather than taking the first matching product ID. Keep receivers
on the same ports when possible; if you move one, select it again in the setup.
USB address is a fallback when the USB library cannot supply a port path.

Up to four bridge slots each have independent sockets, input state, tilt
hysteresis, logs and test results. A disconnected reader releases only that
player's controls. Failed readers now restart automatically, with retries spaced
from 0.5 to 5 seconds. Reconnect a receiver to the same USB port and turn on the
guitar; its virtual controller identity and player assignment remain intact.
**Retry now** requests recovery from the existing supervisor without another
administrator dialog. Other players continue independently. If you move the
receiver to another port, stop the session and update its device selection.

A reader heartbeat runs every 0.5 seconds, independently of guitar input. If the
reader or its connection stalls for 3 seconds, the adapter releases that player's
held controls. An idle guitar stays connected; heartbeat messages do not replay
notes. Unresponsive readers are restarted, and status distinguishes connection
loss from successful game registration. Retrying stops when the game/test exits
or its session owner disappears. Each player's `reader-status.json`, `status.json`
and `bridge.log` provide recovery diagnostics.

These checks cover USB removal, reader failures and stalled software connections.
A live receiver/reader does not prove its radio link is healthy; silence alone
is not treated as a disconnect. Charge and re-pair the guitar if it stops sending
input while the receiver remains connected. Native controller reconnect behavior
belongs to macOS/the game; MacRiff shows missing devices but does not restart or
emulate native Xbox/PS3 controllers. This recovery supervisor is used by the Setup
app; the legacy command-line launcher does not provide automatic USB retries.

**Disconnect Tests** stops testing. **Stop Game** requests a normal game quit.
Closing Setup stops a standalone test through the session owner's watchdog.
A launched game can continue after Setup closes; quitting the game releases
its USB readers. Use **Logs** for the current session's per-player diagnostics.

## Riffmaster mapping

Both fret rows combine into the same five colors. Dedicated fret masks prevent
joystick flags from becoming false fret presses.

| Physical control | Controller input / action |
| --- | --- |
| Green, Red, Yellow, Blue, Orange | A, B, Y, X, Left Shoulder / matching fret colors |
| Strum up/down | D-pad up/down |
| Menu | Start / Pause |
| View | Select / Star Power |
| Tilt | Separate analog tilt axis plus Select above the activation threshold |
| Whammy | Right stick X, independent of the joystick |
| Joystick X/Y and click | Left stick axes/button, available for custom mapping |

The stick retains signed 16-bit input with a rescaled 12% deadzone. Whammy and
tilt retain all 256 reported levels. Digital tilt activation/release thresholds
differ to reduce chatter. Guitar names are supplied to the controller API, but
Clone Hero may show generic A/B/X/Y names in some screens. Guide/Share gameplay
buttons are not implemented.

## Current support and verification

- Xbox Riffmaster → Clone Hero: one physical guitar has been tested. Automated
  tests verify four simultaneous virtual controllers in the installed game's
  actual Rewired library, independent input/tilt, and isolated disconnect/reconnect.
- Native Xbox/PS3 controllers: existing working game support is preserved. The
  setup routes them natively; a four-device mixed physical session has not been
  tested here.
- MIDI drums: macOS source discovery and native routing. Pad/note mapping stays
  in the game and needs a real-kit test.
- YARG: native launch only. The Riffmaster-to-YARG bridge is not implemented.
- Unknown device/protocol: no universal emulation claim. Requires a tested decoder
  unless the device already works natively in the selected game.

## Files, safety and restoration

The installed app bundles its runtime. Working files and a locally signed Clone
Hero copy live under `~/Library/Application Support/MacRiff/`. The original game
is unchanged. Native-only sessions launch the original game. Bridge sessions
load the adapter only into the separate copy; existing native GameController
entries are preserved alongside the virtual guitars.

Only USB readers run with administrator privileges. No system driver,
Accessibility permission, network listener or upload is used. Session folders
are private (`/tmp/macriff-band.*`); each bridge player has their own subfolder.

Default maps are written only for selected bridged player slots. Existing maps
are preserved. Changes are backed up to `build/settings-backups/`. Restore a map
with `swift restore-controller-settings.swift BACKUP.plist` while the game is
closed. Saved MacRiff setups are separate from your game profiles and songs.

For troubleshooting, check the selected route, device connection, player
assignment and instrument in the game. A visible MIDI/HID device is not proof
of compatible game mappings. Game updates may require adapter retesting.

## Development checks

```bash
bash build-setup.sh
node --test tests/*.test.js
python3 tests/controller-recovery.py "$PWD/MacRiff Setup.app/Contents/Resources/Runtime"
```

`tests/controller-multi-probe.m` loads Clone Hero's Rewired library and verifies
four independent controllers, fragmented messages and reconnection. The single
controller probe and standalone host test remain available. Recovery tests cover
reader crashes/stalls, per-player isolation, heartbeat-only idle, held-input
release, manual retry and owner shutdown. Physical unplug/replug recovery still
needs a real session check after installing the update. The setup app's
`--self-test` checks native Xbox/PS3 routing, MIDI drums, mixed bridging, duplicate
device prevention, test gating and saved setup serialization without USB claims.

Primary references: [Clone Hero multiplayer assignment](https://wiki.clonehero.net/books/general-info/page/frequently-asked-questions),
[Clone Hero drum mapping](https://wiki.clonehero.net/books/guitars-drums-controllers/page/drum-mapping-guide),
[YARG MIDI instrument profiles](https://yarg.in/news/0036_yarg-0.14.0),
[PlasticBand Riffmaster protocol](https://github.com/TheNathannator/PlasticBand/blob/master/Docs/Instruments/5-Fret%20Guitar/Rock%20Band/Xbox%20One.md).
