from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock, Semaphore
from time import time
from typing import Literal
import json
import os
import re
import shutil
import subprocess
import uuid

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field

from .pipeline import ROOT, convert, archive, write_song, ffmpeg
from .lyrics import parse_lrc, to_lrc
from .chart import TempoMap, clean
from .artwork import save_image
from .youtube import download_youtube, normalize_youtube_url, search_youtube
from .midi import validate_midi
from .chart_search import search_charts
from .library import publish, install_status, songs_root

OUTPUT = Path(os.environ.get("BACKSTAGE_OUTPUT_DIR", str(ROOT / "output"))).expanduser().resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)
pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix='song-queue')
download_slots = Semaphore(2)
conversion_slot = Semaphore(1)
search_slot = Semaphore(1)
preview_lock = Lock()
MAX_QUEUE = 20
ACTIVE_STATUSES = ('uploading', 'queued', 'downloading', 'processing')
jobs: dict[str, dict] = {}
edit_lock = Lock()
app = FastAPI(title="Backstage · Add New Song", docs_url=None, redoc_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "testserver"])


@app.middleware("http")
async def local_requests(request: Request, call_next):
    origin = request.headers.get("origin")
    if request.method in ("POST", "PUT", "DELETE") and origin and origin != f'{request.url.scheme}://{request.headers.get("host")}':
        return JSONResponse({"detail": "Only requests from this local app are accepted."}, status_code=403)
    size = request.headers.get("content-length", "0")
    if not size.isdigit() or int(size) > 270 * 1024 * 1024:
        return JSONResponse({"detail": "Upload too large (250 MB audio, 12 MB cover maximum)."}, status_code=413)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def job_path(job_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(404, "Song not found.")
    path = OUTPUT / job_id
    if not path.is_dir():
        raise HTTPException(404, "Song not found.")
    return path


def result_for(job_id: str) -> tuple[Path, dict]:
    path = job_path(job_id)
    if not (path / "result.json").exists():
        raise HTTPException(409, "This song is not ready yet.")
    return path, json.loads((path / "result.json").read_text(encoding="utf-8"))


async def save_upload(upload: UploadFile, path: Path, limit: int):
    size = 0
    with path.open("wb") as handle:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise HTTPException(413, "File is too large.")
            handle.write(chunk)
    await upload.close()
    if not size:
        raise HTTPException(400, "The uploaded file is empty.")


def run_job(job_id: str, audio: Path | None, options: dict):
    phase = 'processing'
    def progress(percent, message):
        jobs[job_id] = {"status": phase, "progress": percent, "message": message}
    try:
        if options.get('youtube_url'):
            phase = 'downloading'
            with download_slots:
                audio, metadata, source = download_youtube(options['youtube_url'], OUTPUT / job_id, progress,
                                                          include_video=options.get('youtube_video', False),
                                                          video_quality=options.get('youtube_quality', '1080'))
            for key, value in metadata.items():
                if not options.get(key):
                    options[key] = str(value)
            options['original_stem'] = metadata['title']
            options['source'] = source
            record_path = OUTPUT / job_id / 'job.json'
            if record_path.exists():
                record = json.loads(record_path.read_text())
                record['title'] = options.get('title') or metadata['title']
                record_path.write_text(json.dumps(record))
        jobs[job_id] = {'status': 'queued', 'progress': 25 if options.get('youtube_url') else 0,
                        'message': 'Audio ready. Waiting for conversion…'}
        with conversion_slot:
            phase = 'processing'
            convert(OUTPUT / job_id, audio, options,
                    (lambda p, m: progress(25 + int(.74 * p), m)) if options.get('youtube_url') else progress)
        try:
            installed = publish(OUTPUT / job_id)
            message = installed['message']
        except Exception:
            import logging
            logging.exception('Backstage library installation failed; converted export retained')
            installed = {'status': 'error', 'message': 'Converted, but installation failed. Check the Songs folder and retry.'}
            (OUTPUT / job_id / 'library.json').write_text(json.dumps(installed))
            message = installed['message']
        jobs[job_id] = {"status": "complete", "progress": 100, "message": message}
    except Exception as exc:
        import logging
        logging.exception("Song conversion failed")
        message = str(exc) if isinstance(exc, ValueError) else "Conversion failed. Check the terminal for details and try another audio file."
        jobs[job_id] = {"status": "error", "progress": 0, "message": message}
        (OUTPUT / job_id / "error.json").write_text(json.dumps(jobs[job_id]))


@app.get("/api/health")
def health():
    return {"ffmpeg": bool(shutil.which("ffmpeg")), 'image_search': 'Playwright',
            'queue_limit': MAX_QUEUE, "output": str(OUTPUT),
            'product': 'Backstage', 'songs_root': str(songs_root())}


@app.get('/api/library')
def library():
    root = songs_root()
    entries = []
    if root.is_dir():
        for marker in sorted(root.glob('*/.backstage.json')):
            if marker.is_symlink() or marker.parent.is_symlink():
                continue
            try:
                entries.append({**json.loads(marker.read_text()), 'path': str(marker.parent)})
            except (OSError, ValueError):
                continue
    return {'path': str(root), 'songs': entries, 'refresh': 'Use Scan Songs in Backstage after installation.'}


@app.post('/api/jobs/{job_id}/install')
def install_job(job_id: str):
    path, _ = result_for(job_id)
    try:
        return publish(path)
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(409, 'Could not install this song. Check the export and Songs folder permissions.') from exc


@app.get('/api/youtube/search')
def youtube_search(q: str = Query(min_length=2, max_length=200)):
    if len(q.strip()) < 2:
        raise HTTPException(400, 'Enter an artist or song title to search.')
    if not search_slot.acquire(blocking=False):
        raise HTTPException(429, 'Another search is running. Try again in a moment.')
    try:
        return {'results': search_youtube(q)}
    except ValueError as exc:
        raise HTTPException(502, str(exc))
    finally:
        search_slot.release()


@app.get('/api/charts/search')
def chart_search(q: str = Query(min_length=2, max_length=200),
                 instrument: Literal['', 'guitar', 'bass', 'rhythm', 'drums', 'keys'] = '',
                 difficulty: Literal['', 'easy', 'medium', 'hard', 'expert'] = '',
                 page: int = Query(default=1, ge=1, le=100)):
    if len(q.strip()) < 2:
        raise HTTPException(400, 'Enter an artist or song title to search.')
    try:
        return search_charts(q, instrument, difficulty, page)
    except ValueError as exc:
        raise HTTPException(502, str(exc))


@app.get('/api/queue')
def queue_status():
    entries = []
    records = sorted(OUTPUT.glob('*/job.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:100]
    for path in records:
        try:
            record = json.loads(path.read_text())
            record.update(job_status(path.parent.name))
            entries.append(record)
        except (OSError, ValueError):
            continue
    return sorted(entries, key=lambda entry: entry['created_at'])


@app.post("/api/jobs", status_code=202)
async def create_job(audio: UploadFile | None = File(None), cover: UploadFile | None = File(None),
                     youtube_url: str = Form('', max_length=2048),
                     youtube_video: bool = Form(False),
                     youtube_quality: Literal['720', '1080', 'best'] = Form('1080'),
                     title: str = Form("", max_length=200), artist: str = Form("", max_length=200),
                     album: str = Form("", max_length=200), genre: str = Form("", max_length=100),
                     year: str = Form("", max_length=20), charter: str = Form("Autochart", max_length=100),
                     bpm: str = Form(""), lyrics_mode: Literal["auto", "skip"] = Form("auto"),
                     model: Literal["tiny", "base", "small", "medium"] = Form("base"),
                     language: str = Form("", max_length=8), lrc: str = Form("", max_length=200000),
                     art_mode: Literal["google", "offline"] = Form("google"), art_query: str = Form("", max_length=300),
                     video: bool = Form(False)):
    if not shutil.which("ffmpeg"):
        raise HTTPException(503, "Install FFmpeg first: brew install ffmpeg")
    has_audio = bool(audio and audio.filename)
    if has_audio == bool(youtube_url.strip()):
        raise HTTPException(400, 'Choose either an audio file or a YouTube video link.')
    if youtube_video and not youtube_url.strip():
        raise HTTPException(400, 'Choose YouTube link to include its video background.')
    if youtube_url.strip():
        try:
            youtube_url = normalize_youtube_url(youtube_url)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
    extension = Path(audio.filename or '').suffix.lower() if has_audio else ''
    if has_audio and extension not in (".mp3", ".wav", ".ogg", ".flac", ".m4a", ".alac", ".mp4", ".aif", ".aiff", ".aac", ".opus"):
        raise HTTPException(400, "Choose MP3, FLAC, ALAC (.m4a or .alac), WAV, AIFF, OGG, AAC, or OPUS audio.")
    if sum(j["status"] in ACTIVE_STATUSES for j in list(jobs.values())) >= MAX_QUEUE:
        raise HTTPException(429, f'The queue holds {MAX_QUEUE} songs. Wait for a song to finish, then add the remaining songs.')
    try:
        parsed_bpm = float(bpm) if bpm.strip() else None
        if parsed_bpm is not None and not 30 <= parsed_bpm <= 300:
            raise ValueError()
    except ValueError:
        raise HTTPException(400, "BPM must be between 30 and 300, or left blank.")
    if language and not re.fullmatch(r"[a-z]{2,3}", language):
        raise HTTPException(400, "Language must be a code such as en, es, or ja.")
    job_id = uuid.uuid4().hex
    path = OUTPUT / job_id
    path.mkdir()
    # Reserve capacity before awaiting upload reads, including simultaneous submissions.
    jobs[job_id] = {'status': 'uploading', 'progress': 0, 'message': 'Receiving your audio…'}
    source = path / ("input" + extension) if has_audio else None
    try:
        if has_audio:
            await save_upload(audio, source, 250 * 1024 * 1024)
        if cover and cover.filename:
            await save_upload(cover, path / "cover.upload", 12 * 1024 * 1024)
    except Exception:
        shutil.rmtree(path)
        jobs.pop(job_id, None)
        raise
    options = dict(title=title, artist=artist, album=album, genre=genre, year=year, charter=charter,
                   bpm=parsed_bpm, lyrics_mode=lyrics_mode, model=model, language=language, lrc=lrc,
                   art_mode=art_mode, art_query=art_query, video=video,
                   youtube_url=youtube_url, youtube_video=youtube_video, youtube_quality=youtube_quality,
                   original_stem=Path(audio.filename or "Untitled").stem if has_audio else 'YouTube song')
    record = {'id': job_id, 'title': title or (audio.filename if has_audio else youtube_url),
              'created_at': time(), 'source': 'YouTube' if youtube_url else 'Audio file'}
    (path / 'job.json').write_text(json.dumps(record), encoding='utf-8')
    jobs[job_id] = {"status": "queued", "progress": 0, "message": "Waiting for conversion…"}
    pool.submit(run_job, job_id, source, options)
    return {"id": job_id}


@app.get("/api/jobs")
def history():
    results = []
    for path in sorted(OUTPUT.glob("*/result.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:20]:
        result = json.loads(path.read_text(encoding="utf-8"))
        results.append({"id": path.parent.name, "title": result["metadata"]["title"], "artist": result["metadata"]["artist"],
                        "full_band": bool(result['analysis'].get('instruments')), "updated_at": path.stat().st_mtime})
    return results


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    path = job_path(job_id)
    if job_id in jobs:
        status = dict(jobs[job_id])
        if status.get('status') == 'complete':
            status['library'] = install_status(path)
        return status
    if (path / "result.json").exists():
        return {"status": "complete", "progress": 100, 'library': install_status(path)}
    if (path / "error.json").exists():
        return json.loads((path / "error.json").read_text())
    return {"status": "error", "message": "The app restarted before conversion finished. Upload the song again."}


@app.get("/api/jobs/{job_id}/result")
def result(job_id: str):
    return result_for(job_id)[1]


@app.get('/api/jobs/{job_id}/drums-check')
def drums_check(job_id: str):
    path, result = result_for(job_id)
    midi = path / result['folder'] / 'notes.mid'
    if not midi.is_file():
        return {'ready': False, 'message': 'This is an older guitar-only export. Upgrade to full band to add drums.'}
    try:
        counts = validate_midi(midi, ('Drums',))['Drums']
    except (ValueError, OSError, EOFError) as exc:
        return {'ready': False, 'message': 'This saved MIDI does not contain a complete drum chart. Use Upgrade to full band to rebuild it.'}
    return {'ready': True, 'counts': counts,
            'message': 'Drum notes verified in the exported MIDI at all four difficulties. Set your Clone Hero profile’s Controller to Drums to select them.'}


class LyricsUpdate(BaseModel):
    text: str = Field(max_length=200000)


def commit_result(path, result):
    folder = path / result['folder']
    lyrics = result['lyric_phrases'] if 'lyric_phrases' in result else parse_lrc(result['lyrics'], result['analysis']['duration'])
    result['validated_tracks'] = write_song(folder, result['metadata'], result['analysis'], lyrics)
    result['format_version'] = 2 if 'instruments' in result['analysis'] else 1
    result['counts'] = {d: len(notes) for d, notes in result['analysis']['tracks'].items()}
    result['instrument_counts'] = {i: {d: len(n) for d, n in tracks.items()} for i, tracks in result['analysis'].get('instruments', {'Guitar': result['analysis']['tracks']}).items()}
    (folder / 'conversion-report.json').write_text(json.dumps({k: v for k, v in result.items() if k not in ('analysis', 'lyric_phrases')}, indent=2), encoding='utf-8')
    archive(folder, path)
    (path / 'result.json').write_text(json.dumps(result), encoding='utf-8')


@app.put("/api/jobs/{job_id}/lyrics")
def update_lyrics(job_id: str, update: LyricsUpdate):
    with edit_lock:
        path, result = result_for(job_id)
        try:
            lyrics = parse_lrc(update.text, result["analysis"]["duration"])
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        result["lyrics"] = to_lrc(lyrics)
        result['lyric_phrases'] = lyrics
        result["lyrics_status"] = "Manually reviewed"
        commit_result(path, result)
        return {"message": "Lyrics saved to the chart and ZIP.", "lyrics": result["lyrics"]}


class MetadataUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    artist: str = Field(min_length=1, max_length=200)
    album: str = Field(default='', max_length=200)
    genre: str = Field(default='', max_length=100)
    year: str = Field(default='', max_length=20)
    charter: str = Field(default='Autochart', max_length=100)


@app.put('/api/jobs/{job_id}/metadata')
def update_metadata(job_id: str, update: MetadataUpdate):
    if not clean(update.title) or not clean(update.artist):
        raise HTTPException(400, 'Add a title and artist.')
    with edit_lock:
        path, result = result_for(job_id)
        result['metadata'] = {key: clean(value) for key, value in update.model_dump().items()}
        commit_result(path, result)
        return result['metadata']


class NoteUpdate(BaseModel):
    time: float = Field(ge=0, allow_inf_nan=False)
    duration: float = Field(default=0, ge=0, le=10, allow_inf_nan=False)
    lanes: list[int] = Field(min_length=1, max_length=5)


class TrackUpdate(BaseModel):
    notes: list[NoteUpdate] = Field(min_length=1, max_length=20000)


@app.put('/api/jobs/{job_id}/tracks/{instrument}/{difficulty}')
def update_track(job_id: str, instrument: str, difficulty: str, update: TrackUpdate):
    with edit_lock:
        path, result = result_for(job_id)
        analysis = result['analysis']
        instruments = analysis.get('instruments', {'Guitar': analysis['tracks']})
        if instrument not in instruments or difficulty not in instruments[instrument]:
            raise HTTPException(400, 'Choose an available instrument and difficulty.')
        timing = TempoMap(**analysis['timing'])
        max_lane = 4 if instrument == 'Drums' or difficulty in ('Hard', 'Expert') else (2 if difficulty == 'Easy' else 3)
        notes = []
        for item in sorted(update.notes, key=lambda n: n.time):
            if item.time >= analysis['duration'] or any(lane < 0 or lane > max_lane for lane in item.lanes):
                raise HTTPException(400, 'Note is outside the song or uses a fret unavailable at this difficulty.')
            lanes = sorted(set(item.lanes))
            if instrument == 'Drums' and len([lane for lane in lanes if lane]) > 2:
                raise HTTPException(400, 'Drum hits may use at most two hands and a kick.')
            tick = timing.tick(item.time)
            if notes and tick <= notes[-1]['tick']:
                raise HTTPException(400, 'Combine simultaneous notes into one chord.')
            length = min(item.duration, analysis['duration'] - item.time) if instrument != 'Drums' else 0
            notes.append({'time': item.time, 'tick': tick, 'lanes': lanes, 'duration': length,
                          'length': max(0, timing.tick(item.time + length) - tick)})
        for current, following in zip(notes, notes[1:]):
            if current['tick'] + current['length'] >= following['tick']:
                current['length'] = max(0, following['tick'] - current['tick'] - 1)
                current['duration'] = max(0, following['time'] - current['time'] - .01)
        instruments[instrument][difficulty] = notes
        if instrument == 'Guitar':
            analysis['tracks'] = instruments['Guitar']
        commit_result(path, result)
        return {'notes': notes, 'instrument_counts': result['instrument_counts'], 'message': 'Track saved to every export.'}


@app.post('/api/jobs/{job_id}/cover')
def update_cover(job_id: str, cover: UploadFile = File(...)):
    with edit_lock:
        path, result = result_for(job_id)
        data = cover.file.read(12 * 1024 * 1024 + 1)
        folder = path / result['folder']
        try:
            save_image(data, folder / 'album.png')
        except Exception:
            raise HTTPException(400, 'Choose a valid PNG, JPG, or WEBP under 12 MB.')
        result['artwork'] = {'source': 'Uploaded cover'}
        if (folder / 'video.mp4').exists() and result.get('video', {}).get('source') == 'Cover artwork':
            ffmpeg(['-loop', '1', '-framerate', '1', '-i', str(folder / 'album.png'), '-t', str(result['analysis']['duration']),
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-r', '24', '-pix_fmt', 'yuv420p', '-an', str(folder / 'video.mp4')])
        commit_result(path, result)
        return {'message': 'Cover updated.'}


@app.post('/api/jobs/{job_id}/background')
def add_background(job_id: str, video: UploadFile = File(...), youtube_url: str = Form(...),
                   alignment: str = Form('{}', max_length=10000), replace_cover: bool = Form(False)):
    """Attach a prepared background without regenerating audio, charts, or edits."""
    path, _ = result_for(job_id)
    try:
        url = normalize_youtube_url(youtube_url)
        match = json.loads(alignment)
        if not isinstance(match, dict):
            raise ValueError('Invalid alignment report.')
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    temporary = path / f'.background-{uuid.uuid4().hex}.mp4'
    try:
        size = 0
        with temporary.open('wb') as handle:
            while chunk := video.file.read(1024 * 1024):
                size += len(chunk)
                if size > 250 * 1024 * 1024:
                    raise HTTPException(413, 'Video exceeds 250 MB.')
                handle.write(chunk)
        try:
            probe = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(temporary)],
                                   capture_output=True, text=True, timeout=20, check=True)
            streams = json.loads(probe.stdout)['streams']
            if len(streams) != 1 or streams[0].get('codec_name') != 'h264':
                raise ValueError()
        except (ValueError, KeyError, subprocess.SubprocessError):
            raise HTTPException(400, 'Use a silent H.264 MP4 background.')
        with edit_lock:
            path, result = result_for(job_id)
            folder = path / result['folder']
            destination = folder / 'video.mp4'
            if destination.exists() and not replace_cover:
                raise HTTPException(409, 'This song already has a video background.')
            if abs(float(streams[0].get('duration', 0)) - result['analysis']['duration']) > 3:
                raise HTTPException(400, 'Video duration does not match this song.')
            temporary.replace(destination)
            result['video'] = {'included': True, 'source': 'YouTube', 'file': 'video.mp4',
                               'url': url, 'alignment': match, 'processing': 'Added to existing song'}
            (folder / 'conversion-report.json').write_text(json.dumps(
                {k: v for k, v in result.items() if k not in ('analysis', 'lyric_phrases')}, indent=2), encoding='utf-8')
            archive(folder, path)
            staged_result = path / 'result.tmp.json'
            staged_result.write_text(json.dumps(result), encoding='utf-8')
            staged_result.replace(path / 'result.json')
            return {'message': 'Video background added to the song folder and ZIP.', 'video': result['video']}
    finally:
        temporary.unlink(missing_ok=True)
        video.file.close()


@app.post('/api/jobs/{job_id}/upgrade', status_code=202)
def upgrade(job_id: str):
    if sum(j['status'] in ACTIVE_STATUSES for j in list(jobs.values())) >= MAX_QUEUE:
        raise HTTPException(429, 'Wait for a conversion to finish.')
    path, result = result_for(job_id)
    new_id = uuid.uuid4().hex
    destination = OUTPUT / new_id
    destination.mkdir()
    folder = path / result['folder']
    shutil.copy2(folder / 'song.ogg', destination / 'input.ogg')
    shutil.copy2(folder / 'album.png', destination / 'cover.upload')
    options = dict(result['metadata'], original_stem=result['metadata']['title'], lyrics_mode='skip', lrc=result['lyrics'],
                   art_mode='offline', video=(folder / 'video.mp4').exists())
    jobs[new_id] = {'status': 'queued', 'progress': 0, 'message': 'Adding every instrument and difficulty…'}
    (destination / 'job.json').write_text(json.dumps({'id': new_id, 'title': result['metadata']['title'],
                                                     'created_at': time(), 'source': 'Full-band upgrade'}))
    pool.submit(run_job, new_id, destination / 'input.ogg', options)
    return {'id': new_id}


@app.get("/api/jobs/{job_id}/download")
def download(job_id: str):
    path, result = result_for(job_id)
    return FileResponse(path / "song.zip", filename=result["folder"] + ".zip", media_type="application/zip")


@app.get("/api/jobs/{job_id}/files/{filename}")
def asset(job_id: str, filename: str):
    if filename not in ("album.png", "song.ogg", "preview.m4a", "notes.mid", "notes.chart", "song.ini", "lyrics.lrc", "video.mp4"):
        raise HTTPException(404, "File not found.")
    path, result = result_for(job_id)
    if filename == 'preview.m4a':
        file = path / filename
        if not file.is_file():
            # Existing library entries get an AAC copy the first time they open.
            with preview_lock:
                if not file.is_file():
                    source = path / result['folder'] / 'song.ogg'
                    try:
                        ffmpeg(['-i', str(source), '-vn', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k',
                                '-movflags', '+faststart', str(file)])
                    except (OSError, ValueError, subprocess.SubprocessError):
                        file.unlink(missing_ok=True)
                        raise HTTPException(503, 'The audio preview could not be prepared. Try reopening the song.') from None
    else:
        file = path / result["folder"] / filename
    if not file.is_file():
        raise HTTPException(404, "File not found.")
    media_type = {'song.ogg': 'audio/ogg', 'preview.m4a': 'audio/mp4'}.get(filename)
    return FileResponse(file, media_type=media_type)


app.mount("/", StaticFiles(directory=ROOT / "songmaker" / "static", html=True), name="static")
