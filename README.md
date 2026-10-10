# Backstage

Backstage is a rhythm gaming and venue operations product: a customer game,
local hardware/employee tools, and a future multi-venue management platform.

**Every agent and contributor starts with [backstage-specs / meta](https://github.com/Hanzala-plyance/backstage-specs/tree/meta).**
That branch owns the [business logic](https://github.com/Hanzala-plyance/backstage-specs/blob/meta/business/product.md),
[constitution](https://github.com/Hanzala-plyance/backstage-specs/blob/meta/governance/constitution.md),
OpenSpec features, decisions, handoffs, and deltas over time. Keep the same change
ID in specs, implementation, and release reviews. Agents should challenge brittle
code and poor designs with concrete reasoning and a better alternative.

## Branches and stability

| Branch | Purpose |
| --- | --- |
| `starter` | Original imported reference projects |
| `develop` | Backstage integration and small verified feature increments |
| `stage` | Candidates from develop for acceptance testing |
| `main` | Stable releases promoted from stage only |

All product changes travel **feature -> develop -> stage -> main**. Main cannot
receive failing checks, unbuilt candidates, or unverified gameplay/hardware.
The initial stage/main bootstrap contains documentation and promotion controls;
no game release has passed acceptance yet. See the [release evidence](https://github.com/Hanzala-plyance/backstage-specs/blob/meta/releases/0.2.0-desktop.md).

## Desktop web application

The active runtime is a native **Electron + React + TypeScript** application with
Three.js gameplay and browser audio. It offers a local song library, original
practice track, song search/preparation queue, configurable gamepad buttons/axes,
keyboard input and MIDI drums. Five-fret guitar includes circular 3D gems, HOPOs,
taps, anchoring, scored sustains, solo bonuses and Star Power doubling the multiplier.
It needs no Unity installation.

```bash
npm --prefix desktop ci
npm --prefix desktop run build
npm --prefix desktop start
```

Use `npm --prefix desktop run dev` for fast iteration, or `npm --prefix desktop run package`
for a native bundle. On macOS, double-click **Start Backstage.command** after packaging.
See [desktop setup, controls and limits](https://github.com/Hanzala-plyance/backstage/blob/develop/desktop/README.md).

- `desktop/`: active desktop application and rhythm runtime.
- `song-converter/` and `Add New Song/`: optional Python preparation service.
- `mac-riff/`: native controller tools and the separate Clone Hero bridge reference.
- `Backstage/`: preserved YARG/Unity reference, not bundled in the new application.

Installed songs use `~/Music/Backstage/Songs` (or `BACKSTAGE_SONGS_DIR`). Desktop
Settings can select a different library. Refresh after conversion. Python and
FFmpeg are needed for preparation; local playback and practice work independently.
To set up preparation, run `python3 scripts/setup.py` and select that environment
in the app if it is not already detected.

The first desktop build supports single-player five-lane MIDI charts. Full YARG
parity and universal controller compatibility are not claimed. Configure devices
in **Controllers**, and verify physical behavior before venue use. Reservations,
customer session controls, employee authorization and fleet management remain on
the [roadmap](https://github.com/Hanzala-plyance/backstage-specs/blob/meta/business/product.md).

## Planning and contribution

Clone backstage-specs, switch to `meta`, run `npm ci` and `npm run store:register`.
Read the business context and active change before coding. Create feature branches
from develop, validate the OpenSpec change, and record test evidence and handoff.
Promotions use PRs with passing checks and `release/acceptance.json` tied to the
tested code and a report on meta. Do not claim stable gameplay from file-level tests.

Backstage derives from YARG and incorporates MacRiff and the converter. Preserve
upstream licenses, credits, and third-party notices. Catalog authorization is
separate from download/conversion; venue playback needs authorized content.
