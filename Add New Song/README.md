# Add New Song

Canonical requirements and business rules: [backstage-specs / meta](https://github.com/Hanzala-plyance/backstage-specs/tree/meta).

Run `python3 scripts/setup.py` from the repository root, then double-click
**Open Add New Song.command** on macOS or **Open Add New Song.bat** on Windows.
On other systems run `python3 "Add New Song/start.py"` from the repository root.
FFmpeg and FFprobe must be available. Online discovery needs connectivity;
installed songs remain local. This is a staff preparation tool, not a public kiosk.

Search for a song, add selections to a batch, and queue them, or upload local audio.
Complete exports are validated and installed in `~/Music/Backstage/Songs`.
Set `BACKSTAGE_SONGS_DIR` consistently for the converter and game to override it.
The queue distinguishes converted exports from installed songs and offers an
installation retry. Existing history can be installed with the same button.

In Backstage's music-library menu, use **Scan Songs** after installation. The game
always scans the shared root as well as any folders configured in settings.
**Add New Song (staff)** opens this service from the game; start the service first.

Installed songs are immutable snapshots. Editing notes/metadata/lyrics changes
the converter export only; create a new conversion to install a new snapshot.
Downloads remain available. Use music and charts authorized for your intended use;
a successful conversion does not grant commercial rights.
