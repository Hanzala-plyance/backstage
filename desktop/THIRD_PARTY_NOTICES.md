# Third-party notices

Backstage's guitar judgment and MIDI semantics are adapted from
[YARG.Core](https://github.com/YARC-Official/YARG.Core), revision
`3beb94e526558134145bcd3e409428f759001a40` (YARG contributors).
Upstream licenses that library under LGPL-3.0-or-later. The adaptations in
`src/core/judgment.ts`, `src/core/timeline.ts` and `electron/chart.cjs` are available
under the same license. See `licenses/LGPL-3.0.txt` and `licenses/GPL-3.0.txt`.
Changes: TypeScript audio-clock engine, browser input state, frame-independent beat
integration and JavaScript MIDI normalization. This is an independent runtime;
it does not implement every YARG engine preset or advanced chart extension.

MIDI conventions also reference the Moonscraper parser embedded in YARG.Core,
Copyright (c) 2016-2021 Alexander Ong, BSD 3-Clause license; see
`licenses/Moonscraper-BSD-3-Clause.txt`. No Guitar Hero or Clone Hero art, music, logos or
proprietary game source is included. Interface references are genre conventions.

Complete editable Backstage source, package lock and rebuild instructions:
https://github.com/Hanzala-plyance/backstage/tree/develop/desktop
The packaged app includes the adapted module source under `licensed-source`.
Users may modify/rebuild/repackage these modules. Local signing is ad-hoc; there
is no application integrity lock preventing replacement of a modified build.

Runtime dependencies: React/React DOM (MIT), Three.js (MIT), @tonejs/midi (MIT),
midi-file (MIT). Their licenses are included in `licenses/dependencies` at packaging.
Electron and Chromium notices accompany the framework distribution. The separately
bundled song-converter keeps its upstream attribution in its source; its optional
Python dependencies are installed separately and keep their own licenses.
