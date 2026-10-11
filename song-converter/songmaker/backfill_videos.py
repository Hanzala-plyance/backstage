"""Add missing YouTube backgrounds to existing library songs via the local app.

Run with .venv/bin/python -m songmaker.backfill_videos. Downloads are cached and
existing real backgrounds are skipped. Unknown-source songs require audio matching.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock
import hashlib
import json
import re
import subprocess

import httpx
import numpy as np
from scipy.signal import correlate

from .pipeline import ROOT, ffmpeg, youtube_background
from .youtube import download_youtube, search_youtube

CACHE = ROOT / '.cache' / 'video-backfill'
locks_guard = Lock()
video_locks = {}


def pcm(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0:a:0',
                                   '-vn', '-ac', '1', '-af', 'aresample=2000,asetpts=N/SR/TB', '-ar', '2000', '-f', 'f32le', 'pipe:1'], timeout=120)
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def match_audio(reference, candidate, rate=2000):
    """Match three separated waveform excerpts; reject edits or timing drift."""
    reference = np.asarray(reference, dtype=np.float64)
    candidate = np.asarray(candidate, dtype=np.float64)
    window = min(rate * 12, len(reference) // 6)
    if window < rate:
        raise ValueError('Not enough audio for an alignment check.')
    energy = np.concatenate(([0.0], np.cumsum(candidate * candidate)))
    energy = energy[window:] - energy[:-window]
    offsets, scores = [], []
    for fraction in (.15, .5, .8):
        start = min(len(reference) - window, int(len(reference) * fraction))
        excerpt = reference[start:start + window]
        power = np.dot(excerpt, excerpt)
        if power < 1e-8 or len(candidate) < window:
            raise ValueError('Audio excerpt is silent or too short to compare.')
        values = np.abs(correlate(candidate, excerpt, mode='valid', method='fft'))
        values /= np.sqrt(np.maximum(energy * power, 1e-15))
        position = int(np.argmax(values))
        offsets.append((position - start) / rate)
        scores.append(float(values[position]))
    delta = float(np.median(offsets))
    if min(scores) < .25 or np.median(scores) < .5 or max(offsets) - min(offsets) > .12:
        raise ValueError(f'Audio does not match consistently: scores={np.round(scores, 3).tolist()}, offsets={offsets}')
    return {'method': 'Three waveform excerpts', 'offset_seconds': round(delta, 4),
            'correlation_scores': [round(s, 4) for s in scores], 'offset_spread_seconds': round(max(offsets)-min(offsets), 4)}


def get_media(url):
    key = url.split('v=')[-1].split('&')[0]
    with locks_guard:
        lock = video_locks.setdefault(key, Lock())
    with lock:
        directory = CACHE / key
        directory.mkdir(parents=True, exist_ok=True)
        record = directory / 'download.json'
        if record.exists():
            saved = json.loads(record.read_text())
            media = directory / saved['file']
            if media.exists():
                return media
        for old in directory.glob('input.*'):
            old.unlink()
        media, metadata, source = download_youtube(url, directory, lambda *_: None, include_video=True, video_quality='720')
        record.write_text(json.dumps({'file': media.name, 'metadata': metadata, 'source': source}))
        return media


def is_still_video(path, duration):
    frames = []
    for point in (.2, .5, .8):
        raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(duration * point), '-i', str(path),
                                       '-frames:v', '1', '-vf', 'scale=32:32', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'], timeout=15)
        if len(raw) != 1024:
            return False
        frames.append(np.frombuffer(raw, dtype=np.uint8).astype(float))
    return max(float(np.mean(abs(frame - frames[0]))) for frame in frames[1:]) < .3


def candidates(result):
    source = result.get('source') or {}
    if source.get('url'):
        return [{'url': source['url'], 'title': result['metadata']['title'], 'original': True}]
    title = result['metadata']['title']
    title = re.sub(r'^\d+\s+', '', title)
    title = re.sub(r'\s*— Autochart test', '', title)
    artist = result['metadata']['artist']
    if artist.lower() not in title.lower() and artist not in ('Unknown Artist', 'xotillweod'):
        title = artist + ' ' + title
    found = search_youtube(title + ' official video')
    # Search scores are only candidates. Waveform checks decide whether a video fits.
    found = [item for item in found if abs((item.get('duration') or 0) - result['analysis']['duration']) < 35
             and not re.search(r'\b(live|reaction|tutorial|cover)\b', item['title'], re.I)]
    if artist == 'Travis Scott':
        found.sort(key=lambda item: ('official audio' in item['title'].lower(), item['artist'] != artist))
    return found[:4]


def add_one(path):
    result = json.loads(path.read_text())
    title = result['metadata']['title']
    folder = path.parent / result['folder']
    duration = result['analysis']['duration']
    old_video = folder / 'video.mp4'
    replace = False
    if old_video.exists():
        if result.get('video', {}).get('source') == 'YouTube':
            return {'id': path.parent.name, 'title': title, 'status': 'already present'}
        replace = is_still_video(old_video, duration)
        if not replace:
            return {'id': path.parent.name, 'title': title, 'status': 'already present'}
    reference = None
    errors = []
    print('Checking: ' + title, flush=True)
    for candidate in candidates(result):
        try:
            print('Downloading: ' + candidate['url'] + ' · ' + title, flush=True)
            media = get_media(candidate['url'])
            if candidate.get('original'):
                alignment = {'method': 'Original YouTube source', 'offset_seconds': 0}
            else:
                if reference is None:
                    reference = pcm(folder / 'song.ogg')
                alignment = match_audio(reference, pcm(media))
            offset = alignment['offset_seconds']
            prepared = media.parent / (path.parent.name + '.mp4')
            if abs(offset) <= .035:
                processing = youtube_background(media, prepared, duration)
            else:
                filters = "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1"
                filters += f',tpad=start_mode=clone:start_duration={max(0,-offset)}:stop_mode=clone:stop_duration=3'
                ffmpeg(['-ss', str(max(0, offset)), '-i', str(media), '-map', '0:v:0', '-an', '-vf', filters,
                        '-t', str(duration), '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2',
                        '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(prepared)])
                processing = 'Aligned and encoded H.264'
            alignment['processing'] = processing
            # Preserve exact chart/audio bytes as evidence that only the background changed.
            originals = {name: hashlib.sha256((folder / name).read_bytes()).hexdigest()
                         for name in ('song.ogg', 'notes.mid', 'notes.chart', 'song.ini') if (folder / name).exists()}
            with httpx.Client(base_url='http://127.0.0.1:8765', timeout=180) as client, prepared.open('rb') as video:
                response = client.post(f'/api/jobs/{path.parent.name}/background', files={'video': ('video.mp4', video, 'video/mp4')},
                                       data={'youtube_url': candidate['url'], 'alignment': json.dumps(alignment), 'replace_cover': str(replace).lower()})
                response.raise_for_status()
            for name, digest in originals.items():
                if hashlib.sha256((folder / name).read_bytes()).hexdigest() != digest:
                    raise RuntimeError('Audio or chart changed while adding video: ' + name)
            print('ADDED: ' + title, flush=True)
            return {'id': path.parent.name, 'title': title, 'status': 'added', 'url': candidate['url'],
                    'alignment': alignment, 'replaced_cover_video': replace, 'preserved_files': originals}
        except Exception as exc:
            print('Candidate failed: ' + str(exc), flush=True)
            errors.append(str(exc))
    return {'id': path.parent.name, 'title': title, 'status': 'unmatched', 'errors': errors}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    paths = list((ROOT / 'output').glob('*/result.json'))
    paths.sort(key=lambda p: ('Ex Machina' not in p.read_text(), -(p.stat().st_mtime)))
    results = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        work = {executor.submit(add_one, path): path for path in paths}
        for future in as_completed(work):
            try:
                results.append(future.result())
            except Exception as exc:
                results.append({'id': work[future].parent.name, 'status': 'error', 'error': str(exc)})
            (CACHE / 'report.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results, indent=2), flush=True)


if __name__ == '__main__':
    main()
