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
no game release has passed acceptance yet. See the [release evidence](https://github.com/Hanzala-plyance/backstage-specs/blob/meta/releases/0.1.0-foundation.md).

## First develop increment

- `Backstage/`: branded YARG-based Unity game with preserved engine compatibility.
- `Add New Song/`: staff launcher for song search, batching, queuing, and conversion.
- `song-converter/`: validated exports install into a shared game-readable library.
- `mac-riff/`: Backstage controller setup with native/MIDI routes; Clone Hero's
  Xbox Riffmaster injection bridge is intentionally unavailable for Backstage.

Completed songs install to `~/Music/Backstage/Songs`; set `BACKSTAGE_SONGS_DIR`
consistently to override it. Use **Scan Songs** in the game after installation.
Failed installs retain the conversion and offer retry. Installed songs are fixed
snapshots; later editor changes affect the export only.

## Development setup

On `develop`, install Python 3.11+, Node 22, FFmpeg/FFprobe, Git LFS, and the pinned
Unity editor **6000.3.5f2** for game builds:

```bash
git clone --branch develop --recurse-submodules https://github.com/Hanzala-plyance/backstage.git
cd backstage
git lfs pull
python3 scripts/setup.py
python3 "Add New Song/start.py"
```

On macOS, **Add New Song/Open Add New Song.command**, **Open Controllers.command**, and
**Start Backstage.command** are launchers. The game launcher requires a locally
built `Backstage.app`; it does not substitute an upstream executable.
See [development and verification](https://github.com/Hanzala-plyance/backstage/blob/develop/docs/development.md)
and [Add New Song](https://github.com/Hanzala-plyance/backstage/tree/develop/Add%20New%20Song).

The song-preparation service is local staff tooling, not the finished customer kiosk.
Reservations, session controls, employee authorization, multi-bay dashboards, and
central management remain on the [phased roadmap](https://github.com/Hanzala-plyance/backstage-specs/blob/meta/business/product.md).

## Planning and contribution

Clone backstage-specs, switch to `meta`, run `npm ci` and `npm run store:register`.
Read the business context and active change before coding. Create feature branches
from develop, validate the OpenSpec change, and record test evidence and handoff.
Promotions use PRs with passing checks and `release/acceptance.json` tied to the
tested code and a report on meta. Do not claim stable gameplay from file-level tests.

Backstage derives from YARG and incorporates MacRiff and the converter. Preserve
upstream licenses, credits, and third-party notices. Catalog authorization is
separate from download/conversion; venue playback needs authorized content.
