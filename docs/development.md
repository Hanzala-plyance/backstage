# Development and verification

The active application is `desktop/`. Follow [the desktop guide](../desktop/README.md)
for setup, keyboard/gamepad/MIDI controls, search, conversion, tests and packaging.
Canonical planning is [backstage-specs/meta](https://github.com/Hanzala-plyance/backstage-specs/tree/meta).

The previous Unity foundation was retired from develop and is preserved at tag
`unity-reference` (the unmodified YARG import stays on `starter`). Its old build
instructions are kept in [unity-reference.md](unity-reference.md). The desktop
app does not need it.

Product changes follow feature → develop → stage → main. Stage requires passing
selected-runtime build evidence; main additionally requires actual song playback,
physical controller, clean installation and recovery acceptance. `release/acceptance.json`
starts blocked. A passing automated smoke test does not certify physical devices.
