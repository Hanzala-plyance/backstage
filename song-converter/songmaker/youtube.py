"""Single-video YouTube import, with explicit size and duration limits."""
from pathlib import Path
import re
import os
import shutil
from functools import lru_cache
from time import time
from time import monotonic
from urllib.parse import parse_qs, urlparse


def search_youtube(query: str):
    return _search_youtube(query.strip(), int(time() // 300))


@lru_cache(maxsize=64)
def _search_youtube(query: str, cache_window: int):
    from yt_dlp import YoutubeDL
    options = {'extract_flat': True, 'skip_download': True, 'quiet': True, 'no_warnings': True,
               'socket_timeout': 12, 'retries': 1, 'extractor_retries': 1, 'playlistend': 10}
    try:
        with YoutubeDL(options) as downloader:
            data = downloader.extract_info('ytsearch10:' + query, download=False)
        results = []
        for entry in (data or {}).get('entries', []):
            if not entry or entry.get('live_status') in ('is_live', 'is_upcoming'):
                continue
            duration = entry.get('duration')
            if duration is not None and (duration <= 0 or duration > 1200):
                continue
            try:
                url = normalize_youtube_url('https://youtu.be/' + entry.get('id', ''))
            except ValueError:
                continue
            results.append({'title': entry.get('title') or 'Untitled video', 'artist': entry.get('uploader') or entry.get('channel') or '',
                            'duration': duration, 'url': url, 'id': entry['id'],
                            'thumbnail': f"https://i.ytimg.com/vi/{entry['id']}/mqdefault.jpg"})
        return results
    except Exception:
        raise ValueError('YouTube search is unavailable right now. Paste video links below or try again shortly.') from None


def normalize_youtube_url(value: str) -> str:
    try:
        url = urlparse(value.strip())
        if url.scheme not in ('http', 'https') or url.username or url.password or url.port not in (None, 80, 443):
            raise ValueError()
        host = (url.hostname or '').lower()
        if host in ('youtu.be', 'www.youtu.be'):
            video_id = url.path.strip('/')
        elif host in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'):
            if url.path.rstrip('/') == '/watch':
                video_id = parse_qs(url.query).get('v', [''])[0]
            else:
                match = re.fullmatch(r'/(?:shorts|embed|live)/([\w-]{11})/?', url.path)
                video_id = match[1] if match else ''
        else:
            raise ValueError()
        if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('Paste a link to one YouTube video (youtube.com/watch or youtu.be). Playlists and channel links are not supported.')
    # Drop playlists, timestamps, redirects, and tracking parameters.
    return f'https://www.youtube.com/watch?v={video_id}'


def download_youtube(url: str, job_dir: Path, progress, include_video: bool = False,
                     video_quality: str = '1080'):
    from yt_dlp import YoutubeDL

    url = normalize_youtube_url(url)
    if video_quality not in ('720', '1080', 'best'):
        raise ValueError('Choose 720p, 1080p, or Highest available video quality.')
    video_filter = '' if video_quality == 'best' else f'[height<={video_quality}]'
    started = monotonic()
    limit_mb = 750 if include_video else 250
    limit = limit_mb * 1024 * 1024
    downloaded = {}
    last_percent = 2
    def check_video(info, *, incomplete=False):
        if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming'):
            return 'Live streams are not supported. Choose a finished video.'
        if info.get('duration') and info['duration'] > 1200:
            return 'Choose a YouTube video shorter than 20 minutes.'
        if not incomplete and not info.get('duration'):
            return 'The video has no readable duration. Upload its audio file instead.'

    def hook(status):
        nonlocal last_percent
        downloaded[status.get('filename', 'input')] = status.get('downloaded_bytes', 0)
        if sum(downloaded.values()) > limit:
            raise ValueError(f'YouTube download exceeds the {limit_mb} MB limit.')
        if monotonic() - started > 900:
            raise ValueError('The YouTube download timed out. Try again or upload an audio file.')
        total = status.get('total_bytes') or status.get('total_bytes_estimate') or 0
        percent = min(23, 4 + int(19 * status.get('downloaded_bytes', 0) / total)) if total else 5
        last_percent = max(last_percent, percent)
        progress(last_percent, 'Downloading YouTube audio and video…' if include_video else 'Downloading YouTube audio…')

    class QuietLog:
        def debug(self, *_): pass
        def warning(self, *_): pass
        def error(self, *_): pass

    runtimes = {name: {'path': shutil.which(name)} for name in ('deno', 'node') if shutil.which(name)}
    options = {
        'format': f'bestvideo{video_filter}+bestaudio/best{video_filter}' if include_video else 'bestaudio/best',
        # Prefer resolution first, then H.264 at that resolution to avoid needless encoding.
        'format_sort': ['res', 'vcodec:h264'] if include_video else [],
        'merge_output_format': 'mkv', 'noplaylist': True,
        'outtmpl': str(job_dir / 'input.%(ext)s'),
        'max_filesize': limit, 'match_filter': check_video, 'break_on_reject': True,
        'socket_timeout': 20, 'retries': 2, 'fragment_retries': 2,
        'concurrent_fragment_downloads': 4, 'progress_hooks': [hook],
        'logger': QuietLog(), 'quiet': True, 'no_warnings': True,
        'cachedir': str(Path(os.environ.get('BACKSTAGE_CACHE_DIR', str(Path(__file__).resolve().parent.parent / '.cache'))) / 'yt-dlp'),
        'js_runtimes': runtimes,
    }
    progress(2, 'Reading the YouTube video…')
    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=True)
            if not info or info.get('_type') in ('playlist', 'multi_video'):
                raise ValueError('Choose a single public YouTube video.')
            reason = check_video(info)
            if reason:
                raise ValueError(reason)
    except ValueError:
        raise
    except Exception as exc:
        detail = str(exc).lower()
        if '20 minutes' in detail or 'finished video' in detail or 'readable duration' in detail:
            raise ValueError('Choose a finished YouTube video shorter than 20 minutes.') from None
        raise ValueError('YouTube could not provide this video’s audio. It may require sign-in, be unavailable, or block automated downloads. Try another public video or upload the audio file. No browser cookies or account access are used.') from None
    files = [p for p in job_dir.glob('input.*') if p.suffix.lower() in ('.mkv', '.webm', '.m4a', '.mp4', '.mp3', '.ogg', '.opus', '.aac', '.flac', '.wav')]
    if len(files) != 1 or not files[0].stat().st_size:
        raise ValueError(f'YouTube did not return a media file within the {limit_mb} MB limit.')
    if files[0].stat().st_size > limit:
        raise ValueError(f'YouTube download exceeds the {limit_mb} MB limit.')
    metadata = {'title': info.get('track') or info.get('title') or 'YouTube song',
                'artist': info.get('artist') or info.get('creator') or info.get('uploader') or '',
                'album': info.get('album') or '', 'year': info.get('release_year') or ''}
    return files[0], metadata, {'type': 'YouTube', 'url': url, 'video_id': info['id'],
                                'include_video': include_video,
                                'video_quality': video_quality if include_video else None}
