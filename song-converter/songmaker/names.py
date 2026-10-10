"""Song naming shared with the desktop app (desktop/electron/names.cjs).

Both implementations are tested against desktop/tests/fixtures/song-names.json.
"""
import re

_GENERIC = {'', 'unknown artist', 'youtube artist', 'various artists'}
# Bracketed video decorations, not musical versions like (Live) or (Remix).
_NOISE = re.compile(r'\b(official|video|visuali[sz]er|audio|lyrics?|exclusive|hd|hq|4k|mv|music video)\b', re.I)
_VERSION = re.compile(r'^(remaster(ed)?|remix|live|edit|radio edit|version|mono|stereo|acoustic|demo|instrumental)\b', re.I)
_FEAT = re.compile(r'\s+(?:feat\.?|ft\.?|featuring)\s+', re.I)


def _squash(value) -> str:
    return ' '.join(str(value or '').split())


def clean_song(raw_title, raw_artist) -> tuple[str, str]:
    """Turn YouTube-style metadata into a display title and performing artist."""
    title = re.sub(r'\s*[(\[]([^)\]]*)[)\]]',
                   lambda m: ' ' if _NOISE.search(m[1]) else m[0], str(raw_title or ''))
    artist = _squash(raw_artist)
    if artist.lower() in _GENERIC:
        artist = ''
    known = bool(artist) and artist.lower() in title.lower()
    dash = title.find(' - ')
    gap = re.split(r'\s{2,}', title.strip())
    if dash > 0:
        left, right = title[:dash], title[dash + 3:]
        # "Artist - Title": trust it when it names the known artist, or when the
        # artist field is just an uploader and the right side isn't a version tag.
        if _squash(left).lower() == artist.lower() or (not known and not _VERSION.search(_squash(right))):
            artist, title = _squash(left), right
    elif len(gap) >= 2 and _FEAT.search(' ' + gap[0] + ' '):
        # Uploads like "Artist Feat. Guest  Title" separate parts with spaces.
        artist, title = _squash(gap[0]), ' '.join(gap[1:])
    title = _squash(title)
    featured = _FEAT.split(artist)
    if len(featured) > 1:
        artist = _squash(featured[0])
        title = f"{title} (feat. {_squash(', '.join(featured[1:]))})"
    title = re.sub(r'\((?:feat\.?|ft\.?|featuring)\s+', '(feat. ', title, count=1, flags=re.I)
    title = re.sub(r'\s+(?:feat\.?|ft\.?|featuring)\s+([^()]+)$', r' (feat. \1)', title, flags=re.I)
    if artist.lower() in _GENERIC:
        artist = ''
    return _squash(title), _squash(artist)


def folder_name(title, artist) -> str:
    """"Artist - Title", safe as a single folder name on macOS, Windows and Linux."""
    name = ' - '.join(part for part in (_squash(artist), _squash(title)) if part)
    name = _squash(re.sub(r'[\x00-\x1f<>:"/\\|?*]+', ' ', name))
    name = re.sub(r'^[.\s]+|[.\s]+$', '', name)[:120]
    return re.sub(r'[.\s]+$', '', name) or 'Untitled song'
