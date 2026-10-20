# Autochart · Full band edition

Turn MP3, FLAC, Apple Lossless (ALAC), other audio, or a **YouTube link** into a Clone Hero song folder. The local app generates **guitar, bass, rhythm guitar, and drums**, each with **Easy, Medium, Hard, and Expert**. It includes timed lyrics, artwork, chart previews, and simple editors.

## Start

Double-click **Start Autochart.command**, or run:

```bash
.venv/bin/python run.py
```

Open **http://127.0.0.1:8765**. Keep the Terminal window open while processing music. Control-C stops the app. The server only listens on your computer.

For a fresh installation, use Python 3.11 or 3.12 and FFmpeg:

```bash
brew install ffmpeg node
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python run.py
```

On Windows use `.venv\Scripts\python` instead and install FFmpeg on PATH. The `.command` launcher is for macOS.

## Create and edit

1. Drop in one or more songs, or select **YouTube link** and paste one public video URL per line. You can also search YouTube by artist/title and click **Add** on the results. Supported file inputs: **MP3, FLAC, ALAC (`.m4a`, `.alac`, or `.mp4`), WAV, AIFF, OGG, AAC, and OPUS**. Maximum 250 MB and 20 minutes. Container contents must be readable audio; an extension alone does not make a valid ALAC file.
2. Add a title and artist, or leave them blank to read audio metadata. All 16 instrument/difficulty charts are always included.
3. Choose shared lyrics/artwork/video options, then **Add to queue**. Each song gets its own project and download. The queue stays open when songs finish. Click **Open** when you want to edit a finished song.
4. In the workspace, select any cell in the instrument/difficulty grid. Its number is the number of note groups; a chord is one group.
5. Play or seek the audio to preview. Enable **Edit notes**, pause at a section, then click a note to remove it or an empty position to add a note. **Save chart** updates that instrument and difficulty in the ZIP. **Reset** restores the last saved version. Switching tracks saves pending note changes first. This lightweight editor adds/removes notes; use a dedicated chart editor for detailed sustain, tempo, or phrase editing.
6. Open **Lyrics** to edit timestamps and words, add a line at the current audio position, or remove a line. **Save lyrics** embeds them in the MIDI and refreshes the ZIP.
7. Open **Song details** to edit metadata. Click **Change cover** on the artwork to replace it. These changes update the downloadable song folder.
8. **Download song**, unzip it into Clone Hero's Songs folder, then run **Settings → General → Scan Songs**. Choose the instrument and then its difficulty. See the [official import guide](https://wiki.clonehero.net/books/clone-hero-manual/page/adding-custom-songs).

The original files and both supplied Helicopter reference folders are untouched. Finished folders live in `output/<job-id>/`, alongside `song.zip` and the saved project. **Library** reopens them. Folder names stay stable when editing metadata; the edited title/artist appear in the game through `song.ini`.

## Consistent playback volume

Every new upload and YouTube conversion automatically uses two-pass EBU R128 loudness matching: **−16 LUFS integrated**, with a **−2 dBTP peak target** before OGG encoding. FFmpeg measures the whole song, then applies the measured correction while exporting `song.ogg` at 48 kHz. It preserves dynamics through constant gain when possible and uses peak protection when needed. Quiet intros, duration, video sync, and note timing are retained. This changes the audio itself, so Clone Hero and the browser preview use the same normalized file; it does not depend on ReplayGain support. Lossy encoding can cause small peak/loudness deviations.

The conversion report records input loudness, target, processing mode, and output measurements before encoding. Existing library exports and downloads from external chart sites are unchanged. The website shows “Volume matched across songs” on normalized exports. [FFmpeg loudnorm documentation](https://ffmpeg.org/ffmpeg-filters.html#loudnorm).

The browser preview uses a separate AAC file for compatibility with Safari and Chrome. The full song remains playable in the preview and in the downloaded Clone Hero folder.

## Community chart search

Choose **Chart search** beside Audio file and YouTube link to search Chorus Encore inside Autochart. Filter by instrument and difficulty, compare charters, and see the actual playable difficulty levels for each instrument. **Get chart** opens that specific chart on Chorus Encore, where you choose a version/download format. Community charts are downloaded there; they are not automatically imported into Autochart's editable library. Switching tabs preserves your YouTube links and options. Search responses are cached for five minutes, and **More charts** loads the next page.

The integration uses [Chorus Encore](https://www.enchor.us/)'s public search endpoint, as used by its [Bridge client](https://github.com/Geomitron/Bridge/blob/master/src-angular/app/core/services/search.service.ts). Instrument badges come from playable note counts, not just difficulty metadata that can advertise absent instruments.

## YouTube and optional video

Select **YouTube link**, search by artist/song title or paste `youtube.com/watch`, `youtu.be`, Shorts, or single-video links (one per line), and add them to the queue. Search results show thumbnails, titles, channels, and durations; **Add** collects them in the links box. Searches are cached for five minutes and filter out live and over-20-minute videos. Title/artist are read when available; your manual entries take priority. Links containing a playlist still import only the specified video. Playlists without a video, live streams, videos over 20 minutes, and sign-in-only videos are not supported. Downloads use yt-dlp with no browser cookies or account access. Some public videos can still be blocked by YouTube; errors explain that you can upload the audio instead. A current Node.js (22 or later) or Deno on PATH helps yt-dlp handle YouTube's JavaScript challenges.

**Include video background** is on by default for YouTube imports, and can be switched off for an audio-only download. Choose **720p HD**, **1080p Full HD** (default), or **Highest available** (including 4K when offered by the source). Lower-resolution sources stay at their original resolution; nothing is upscaled. Export preserves the downloaded resolution and frame rate, and shows the actual dimensions in the finished workspace. Turning video on packages a silent H.264 `video.mp4` alongside `song.ogg`, using the same source and start time to keep them aligned. Compatible H.264 video is copied directly into MP4 instead of encoded again; other codecs are converted. It increases download size and conversion time (750 MB combined download limit, versus 250 MB for audio only). Enable song videos in Clone Hero's settings. This MP4 format matches the supplied Helicopter folder and supports Mac/Windows; Linux requires a supported format such as VP8 WebM, per the [official video format guide](https://wiki.clonehero.net/books/clone-hero-manual/page/other-custom-content). When uploading an audio file, the separate optional cover-art video remains available.

## Add missing video backgrounds to existing songs

Run `.venv/bin/python -m songmaker.backfill_videos` while Autochart is running. It checks all finished projects, skips existing YouTube backgrounds, and reuses each import’s original YouTube URL where available. For older audio uploads it searches YouTube and requires three separated audio excerpts to agree on the recording and timing offset before adding a background. It can replace a legacy still-cover video with a matching YouTube video.

Downloads use two workers and a reusable cache in `.cache/video-backfill/`. The operation preserves existing audio, charts, lyrics, and metadata edits, adds `video.mp4`, and refreshes the ZIP. The report records source URLs, alignment evidence, and any unmatched songs. Download the updated ZIP again and replace the extracted copy in Clone Hero. Changing cover artwork now preserves YouTube backgrounds.

## Older exports and difficulty visibility

The original version only generated guitar. Those files already contained four guitar difficulties, which the independent `scan-chart` parser recognizes. They did not contain playable bass, rhythm, or drums. Older exports show **Upgrade to full band** in the library workspace. Upgrading creates a new project from the stored audio, keeps its lyrics/artwork/metadata, and preserves the original export.

New exports use **`notes.mid`**, matching the supplied full-band example. The app encodes all four MIDI difficulty ranges in every instrument track and reads the finished MIDI back before making it available. It rejects files with missing difficulties or unpaired/overlapping notes. A visible grid makes the available instruments and difficulties explicit.

If an old copy still appears in Clone Hero, remove or replace that old extracted song folder and **rescan songs**; downloading a ZIP alone does not update the game's library. Choose Guitar/Bass/Rhythm/Drums rather than an uncharted controller mode such as six-fret guitar. In-game playtesting has not been performed here.

If **Drums isn't selectable**, press **Start/Enter → Controller → Drums** in your Clone Hero profile before choosing the song. A guitar profile offers guitar instruments. See the [official instrument selection guide](https://wiki.clonehero.net/books/clone-hero-manual/page/how-to-play). The workspace's **Play on drums** button checks the actual exported MIDI for all four drum difficulties and shows setup instructions. No separate `drums.ogg` is needed; `song.ogg` contains the full audio mix.

## Song folder format

```text
Artist - Song/
├── notes.mid               # PART GUITAR, PART BASS, PART RHYTHM, PART DRUMS
│                           # all four difficulties, tempo map, star power
│                           # EVENTS + PART VOCALS for timed lyrics
├── song.ini                # enabled instrument ratings, pro_drums = 1
├── song.ogg                # Vorbis audio converted from the input
├── album.png               # 768 × 768 artwork
├── video.mp4               # optional YouTube or cover-art background video
├── lyrics.lrc              # editable timestamped text
└── conversion-report.json  # instrument counts, validation, sources, warnings
```

There is one authoritative playable chart (`notes.mid`) per new export. Old projects retain their `.chart` until upgraded. The supplied full-band reference uses MIDI too: guitar, rhythm, and drums have all four difficulties, while its bass is Expert-only. Autochart generates all four for bass as well.

Drums use standard four-lane mapping with kick, snare, and pro cymbal/tom markers. They are playable in regular and pro drum modes. Simplified difficulties reduce density and simultaneous hand hits. No five-lane drum, six-fret, keyboard, or pitched-vocal performance is generated. Lyrics appear through the `PART VOCALS` lyrics track; this does not claim to generate scored singing gameplay.

Format implementation follows [five-fret MIDI](https://thenathannator.github.io/GuitarGame_ChartFormats/Chart-File-Formats/mid-format/Tracks/5-Fret-Guitar/), [drum MIDI](https://thenathannator.github.io/GuitarGame_ChartFormats/Chart-File-Formats/mid-format/Tracks/Drums/), and the [Clone Hero song.ini guide](https://wiki.clonehero.net/books/guides-and-tutorials/page/songini-guide).

## Lyrics and artwork

Lyrics use faster-whisper locally. The first use of each model downloads it into `.cache/whisper/`; your audio is not uploaded to a transcription provider. Base is the default; Small/Medium may improve singing recognition. Speech-only voice detection is disabled because it can discard vocals in music. You may instead paste existing timestamped LRC lyrics before conversion. Pasted lyrics take priority over transcription.

Artwork uses **Playwright browser search, with no API key or paid search service**. It tries Google Images first; if Google blocks the browser or returns no usable results, it tries Bing Images. The app randomly selects a downloadable image and records the actual source in the workspace/report. Browser searches use a fresh, unsigned-in context and do not read your personal browser profile or bypass challenges. Uploaded cover art takes priority. If both searches fail, the app uses embedded artwork or a generated cover and explains the fallback.

Install Google Chrome, or install Playwright's Chromium with `.venv/bin/python -m playwright install chromium`. Results are cached during the app session, and image downloads retain file-size and public-address checks. Use images you have permission to share when publishing songs.

## Batches and queue

Choose up to **20 songs per batch**, with at most 20 unfinished songs in the queue. Each file is limited to 250 MB; files upload in two concurrent requests so the entire batch doesn't need to fit in one request. YouTube links are submitted separately too. Shared title/artist/lyrics/artwork settings apply to every item; leave title/artist blank to read each song's own metadata.

The **Queue** tab shows each song's upload, download, waiting, conversion, completion, or error status. Open a finished song to edit it or download its ZIP while other songs continue. **Add songs** is available immediately, even during uploads. You can add another batch while an earlier one uploads, downloads, or converts. Two upload slots are shared across all batches, and each batch keeps its own settings. Job completion never pulls you away from a form you are filling out. One invalid file/link does not stop the other items; only failed selections remain in the form for retry.

Accepted queue items are saved on disk and remain visible after a browser refresh. Keep the app process running: a server restart interrupts unfinished jobs and displays an explicit error rather than pretending they completed. Queue processing resumes only after you add those unfinished songs again.


## Processing speed

After decoding the audio once, chart analysis, lyric transcription, and artwork lookup run concurrently in three bounded worker threads. They share the converted audio; the four instruments reuse the same spectrum rather than decoding the song separately. Progress combines all three stages without moving backward. CPU lyric inference uses up to four threads and at most half the detected CPU count to leave capacity for analysis. Up to two YouTube downloads can overlap one conversion. Three bounded job workers and a single conversion slot prevent concurrent model/analysis jobs from exhausting memory. The most recently used lyrics model is retained between songs, eliminating repeated model loading in a batch. Compatible YouTube H.264 backgrounds are remuxed without re-encoding; already compressed audio/video/PNG files are stored directly in ZIPs rather than compressed again.

This overlaps independent work, particularly model loading and image requests. The actual speedup depends on song length, model size, CPU, and connection; it is not a fixed multiplier. Use Tiny/Base or skip lyrics for instrumentals to reduce time further. Per-stage timings are saved in `conversion-report.json` under `processing`.

## Automatic chart limitations

New conversions use harmonic/percussive separation (HPSS) in overlapping, bounded blocks. Guitar, bass, and rhythm use separate tonal frequency ranges, harmonic pitch scoring with interpolated peaks, locally adaptive attack detection, and checks for legato pitch changes. Percussive interruptions of held tones are rejected as false strums. Guitar/rhythm chords require multiple independent spectral pitches; harmonics of one note do not automatically create a chord. Drums use the percussive component: low-band dominance for kicks, spectral shape for snares versus toms, and original high-frequency decay for hats versus crashes. Hit strengths are scaled within each drum band before enforcing hand/kick limits. Guitar starts are aligned to nearby energy rises rather than delayed peaks. Easy guitar merges stable same-pitch passages into holds up to 2.8 seconds, with a lower minimum hold length and tolerance for brief analysis dropouts. Holds stop at rests or pitch changes, and short staccato notes stay taps. Existing projects and manual edits are preserved; these changes apply to newly generated charts. Drum hits are classified from low/mid/high transient energy and constrained to at most two hands plus kick. These are heuristic arrangements, **not isolated instrument transcriptions**. Other instruments can influence a part. Review patterns, beat estimates, and lyrics before sharing; automatic singing recognition can be inaccurate.

A quiet intro is handled by extending the detected beat grid backward, rather than encoding an extremely slow first MIDI beat. Audio and note timestamps remain aligned. BPM override is available for songs with a known fixed tempo.

## Verification

```bash
.venv/bin/python -m unittest discover -s tests -v
node --check songmaker/static/app.js
```

Tests exercise quiet/loud input matching after OGG encoding, stereo/duration/intro/dynamics preservation, known bass notes against kicks, rhythm chords versus single-note overtones, kick/snare/tom/hat/crash classification, all instrument/difficulty ranges, timing, long quiet intros, real FLAC/ALAC decoding, MIDI note pairing, lyric edits, note/metadata edits, API validation, YouTube URL/download limits, optional video inclusion/exclusion, HD format selection and lower-resolution fallback, 1080p/4K preservation, FFmpeg video encoding and duration, and artwork behavior. Automated YouTube tests mock retrieval; video conversion and ZIP checks use real media.

A real Chrome workflow checks upload, all 16 preview selections, note editing, lyric editing, metadata/cover editing, desktop/mobile layouts, library reopening, and downloaded MIDI contents:

```bash
.venv/bin/python -m pip install playwright
# Start Autochart first, and have Google Chrome installed.
.venv/bin/python tests/browser_smoke.py
# Live community chart search, instrument/difficulty filters, mobile layout.
.venv/bin/python tests/browser_chart_search.py
# Optional live network check: YouTube imports with video off and on.
.venv/bin/python tests/browser_youtube.py
# Live batch upload, YouTube search, queue persistence and failure isolation.
.venv/bin/python tests/browser_batch.py
# Video quality controls, mobile layout, and per-batch settings (no downloads).
.venv/bin/python tests/browser_hd_quality.py
# Hold uploads open and add further batches without disabling the form.
.venv/bin/python tests/browser_queue_available.py
```

For independent verification with a Clone Hero-compatible parser:

```bash
npm install --prefix .cache/chart-validator scan-chart
node tests/validate_export.cjs "output/<job-id>/Artist - Song"
```

This checks that the exported file is playable according to `scan-chart` and that all 16 tracks have notes. It is independent of Autochart's MIDI writer. Test screenshots and validation artifacts are stored under `.cache/`.
