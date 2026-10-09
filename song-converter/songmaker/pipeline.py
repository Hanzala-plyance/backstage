from pathlib import Path
import json
import re
import shutil
import subprocess
import zipfile
from time import perf_counter

from .artwork import make_art
from .chart import analyze, render_chart, clean
from .lyrics import transcribe, to_lrc, parse_lrc
from .midi import write_midi
from .parallel import run_stages
from .loudness import normalize_audio

ROOT = Path(__file__).resolve().parent.parent


def ffmpeg(args: list[str]):
    executable = shutil.which("ffmpeg")
    if not executable:
        raise ValueError("FFmpeg is missing. On macOS install it with: brew install ffmpeg")
    result = subprocess.run([executable, "-hide_banner", "-loglevel", "error", "-nostdin", "-y", *args],
                            capture_output=True, text=True, timeout=1800)
    if result.returncode:
        raise ValueError("FFmpeg could not process this file: " + result.stderr[-800:])


def read_metadata(audio: Path) -> dict:
    from mutagen import File
    try:
        media = File(audio, easy=True)
        return {key: str((media.get(tag) or [""])[0]) if media else "" for key, tag in
                [("title", "title"), ("artist", "artist"), ("album", "album"), ("genre", "genre"), ("year", "date")]}
    except Exception:
        return {}


def folder_name(value: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" .")[:140] or "Untitled song"


def video_dimensions(path: Path) -> dict:
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                            'stream=width,height', '-of', 'json', str(path)],
                           capture_output=True, text=True, timeout=15, check=True)
    stream = json.loads(probe.stdout)['streams'][0]
    return {'width': stream['width'], 'height': stream['height']}


def youtube_background(audio: Path, destination: Path, duration: float) -> str:
    """Copy compatible video without encoding it again; otherwise make H.264."""
    compatible = False
    try:
        probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_streams',
                                '-of', 'json', str(audio)], capture_output=True, text=True, timeout=15, check=True)
        stream = json.loads(probe.stdout)['streams'][0]
        compatible = (stream.get('codec_name') == 'h264' and stream.get('pix_fmt') == 'yuv420p'
                      and stream.get('width', 1) % 2 == 0 and stream.get('height', 1) % 2 == 0)
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError):
        pass
    args = ['-i', str(audio), '-map', '0:v:0', '-an', '-t', str(duration)]
    if compatible:
        args += ['-c:v', 'copy']
    else:
        args += ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1',
                 '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-crf', '20', '-pix_fmt', 'yuv420p']
    ffmpeg([*args, '-movflags', '+faststart', str(destination)])
    return 'Copied compatible H.264' if compatible else 'Encoded H.264'


def write_song(folder: Path, metadata: dict, analysis: dict, lyrics: list[dict]):
    if 'instruments' in analysis:
        validated = write_midi(folder / "notes.mid", metadata, analysis, lyrics)
        # Only one authoritative chart in the import folder, as in the full-band reference.
        (folder / "notes.chart").unlink(missing_ok=True)
    else:
        # Keep older exports editable until the user upgrades their arrangement.
        (folder / 'notes.chart').write_text(render_chart(metadata, analysis, lyrics), encoding='utf-8-sig')
        validated = {'Guitar': {d: len(n) for d, n in analysis['tracks'].items()}}
    values = {"name": metadata["title"], "artist": metadata["artist"], "album": metadata.get("album", ""),
              "genre": metadata.get("genre", ""), "year": metadata.get("year", ""), "charter": metadata["charter"],
              "song_length": round(analysis["duration"] * 1000), "preview_start_time": round(min(30, analysis["duration"] / 3) * 1000),
              "diff_guitar": 3, "diff_band": 3 if 'instruments' in analysis else -1, "diff_bass": 3 if 'Bass' in validated else -1,
              "diff_rhythm": 3 if 'Rhythm' in validated else -1, "diff_drums": 3 if 'Drums' in validated else -1, "diff_keys": -1,
              "pro_drums": 1 if 'Drums' in validated else 0, "five_lane_drums": 0, "multiplier_note": 116,
              "diff_guitarghl": -1, "diff_bassghl": -1, "loading_phrase": "Automatically charted with Backstage. Made for your music."}
    (folder / "song.ini").write_text("[song]\n" + "\n".join(f"{key} = {clean(value)}" for key, value in values.items()) + "\n", encoding="utf-8")
    (folder / "lyrics.lrc").write_text(to_lrc(lyrics), encoding="utf-8")
    return validated


def archive(folder: Path, job_dir: Path):
    temp = job_dir / "song.tmp.zip"
    with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(folder.iterdir()):
            if path.is_file():
                bundle.write(path, str(Path(folder.name) / path.name),
                             compress_type=zipfile.ZIP_STORED if path.suffix in ('.ogg', '.mp4', '.png') else zipfile.ZIP_DEFLATED)
    temp.replace(job_dir / "song.zip")


def convert(job_dir: Path, audio: Path, options: dict, progress):
    started = perf_counter()
    progress(5, "Reading your song…")
    from mutagen import File
    try:
        media = File(audio)
        if media and media.info.length > 1200:
            raise ValueError("Choose audio shorter than 20 minutes.")
    except ValueError:
        raise
    except Exception:
        pass  # FFmpeg performs final format validation.
    metadata = read_metadata(audio)
    for key in ("title", "artist", "album", "genre", "year", "charter"):
        metadata[key] = clean(options.get(key) or metadata.get(key) or "")
    metadata["title"] = metadata["title"] or options["original_stem"]
    metadata["artist"] = metadata["artist"] or "Unknown Artist"
    metadata["charter"] = metadata["charter"] or "Backstage"
    folder = job_dir / folder_name(f'{metadata["artist"]} - {metadata["title"]}')
    folder.mkdir()
    warnings = ["Instrument parts are estimated from the mixed audio. Review notes and lyrics before sharing."]
    loudness = normalize_audio(audio, folder / 'song.ogg', progress)
    # Safari does not play OGG/Vorbis consistently. Keep a separate browser
    # preview so the Backstage song.ogg remains unchanged.
    ffmpeg(['-i', str(folder / 'song.ogg'), '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart', str(job_dir / 'preview.m4a')])
    import soundfile as sf
    duration = sf.info(folder / 'song.ogg').duration
    if duration > 1200:
        raise ValueError('Choose audio shorter than 20 minutes.')
    progress(18, 'Analyzing music, extracting lyrics, and preparing artwork together…')
    cover = job_dir / 'cover.upload'

    def charts_task(report):
        report(.05, 'analyzing audio')
        return analyze(folder / 'song.ogg', options.get('bpm'))

    def lyrics_task(report):
        notes = []
        if options.get('lrc'):
            return parse_lrc(options['lrc'], duration), 'Imported timestamped lyrics', notes
        if options['lyrics_mode'] != 'auto':
            return [], 'Skipped (instrumental)', notes
        try:
            def update(percent, message):
                report((percent - 50) / 25, 'loading model' if percent == 50 else 'listening')
            phrases = transcribe(folder / 'song.ogg', duration, options['model'], options.get('language', ''), update)
            notes.append('Sung lyrics and timestamps can be inaccurate. Review and edit them below.')
            return phrases, 'Transcribed locally' if phrases else 'No confident lyrics detected', notes
        except Exception:
            import logging
            logging.exception('Lyrics transcription failed')
            notes.append('Lyrics could not be transcribed. Check your connection for the first model download, or add lyrics in the editor.')
            return [], 'Transcription failed', notes

    def artwork_task(report):
        notes = []
        report(.1, 'finding a cover')
        art = make_art(audio, cover if cover.exists() else None, folder / 'album.png', metadata['title'],
                       options.get('art_query') or f"{metadata['artist']} {metadata['title']} {metadata.get('genre', '')} album cover",
                       options['art_mode'], notes)
        return art, notes

    stages, timings = run_stages({'Charts': charts_task, 'Lyrics': lyrics_task, 'Artwork': artwork_task}, progress)
    analysis = stages['Charts']
    lyrics, lyrics_status, lyric_warnings = stages['Lyrics']
    art, art_warnings = stages['Artwork']
    warnings.extend(lyric_warnings + art_warnings)
    video_source = None
    video_processing = None
    if options.get('youtube_url') and options.get('youtube_video'):
        progress(94, 'Preparing your YouTube video background…')
        # Use the same untrimmed source as song.ogg so video and chart start together.
        video_processing = youtube_background(audio, folder / 'video.mp4', analysis['duration'])
        video_source = 'YouTube'
    elif options.get("video"):
        progress(94, "Making an optional cover-art background video…")
        ffmpeg(["-loop", "1", "-framerate", "1", "-i", str(folder / "album.png"), "-t", str(analysis["duration"]),
                "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
                "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-r", "24", "-pix_fmt", "yuv420p",
                "-an", "-movflags", "+faststart", str(folder / "video.mp4")])
        video_source = 'Cover artwork'
    progress(97, "Writing your Backstage folder…")
    validated = write_song(folder, metadata, analysis, lyrics)
    result = {"metadata": metadata, "analysis": analysis, "lyrics": to_lrc(lyrics), "lyrics_status": lyrics_status,
              "loudness": loudness,
              "source": options.get('source', {'type': 'Audio upload'}),
              "video": {'included': bool(video_source), 'source': video_source, 'file': 'video.mp4' if video_source else None,
                        'processing': video_processing,
                        **(video_dimensions(folder / 'video.mp4') if video_source else {})},
              "artwork": art, "warnings": warnings, "folder": folder.name,
              "lyric_phrases": lyrics, "format_version": 2, "validated_tracks": validated,
              "processing": {"mode": "parallel", "stage_seconds": timings, "seconds_before_packaging": round(perf_counter() - started, 2)},
              "counts": {key: len(value) for key, value in analysis["tracks"].items()},
              "instrument_counts": {instrument: {level: len(notes) for level, notes in tracks.items()}
                                    for instrument, tracks in analysis['instruments'].items()}}
    (folder / "conversion-report.json").write_text(json.dumps({k: v for k, v in result.items() if k != "analysis"}, indent=2), encoding="utf-8")
    archive(folder, job_dir)
    (job_dir / "result.json").write_text(json.dumps(result), encoding="utf-8")
    # Keep only the playable audio rather than retaining a second full upload.
    audio.unlink(missing_ok=True)
    cover.unlink(missing_ok=True)
    return result
