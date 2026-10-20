"""Read-only search of Chorus Encore's public chart index."""
from functools import lru_cache
import re
from time import time

import httpx

LEVELS = ('easy', 'medium', 'hard', 'expert')


def search_charts(query: str, instrument: str = '', difficulty: str = '', page: int = 1):
    return _search_charts(query.strip(), instrument, difficulty, page, int(time() // 300))


@lru_cache(maxsize=64)
def _search_charts(query, instrument, difficulty, page, cache_window):
    try:
        response = httpx.post('https://api.enchor.us/search', json={
            'search': query, 'page': page, 'per_page': 10,
            'instrument': instrument or None, 'difficulty': difficulty or None,
            'drumType': None, 'drumsReviewed': False, 'source': 'api',
        }, timeout=20, headers={'User-Agent': 'Autochart/1.0 (local chart search)'})
        response.raise_for_status()
        data = response.json()
        results, seen = [], set()
        for chart in data['data']:
            md5 = chart.get('md5', '')
            if not re.fullmatch(r'[a-f0-9]{32}', md5) or md5 in seen:
                continue
            seen.add(md5)
            # diff_* metadata can claim instruments that have no playable notes.
            tracks = {}
            for track in (chart.get('notesData') or {}).get('noteCounts', []):
                level, part = track.get('difficulty'), track.get('instrument')
                if level in LEVELS and isinstance(part, str) and track.get('count', 0) > 0:
                    tracks.setdefault(part, set()).add(level)
            tracks = {part: [level for level in LEVELS if level in levels] for part, levels in tracks.items()}
            artwork = chart.get('albumArtMd5') or ''
            results.append({
                'id': md5, 'title': chart.get('chartName') or chart.get('name') or 'Untitled chart',
                'artist': chart.get('artist') or 'Unknown artist', 'charter': chart.get('charter') or 'Unknown charter',
                'duration': (chart.get('song_length') or 0) / 1000, 'tracks': tracks,
                'video': bool(chart.get('hasVideoBackground')),
                'url': f'https://www.enchor.us/chart/{md5}',
                'thumbnail': f'https://files.enchor.us/{artwork}.jpg' if re.fullmatch(r'[a-f0-9]{32}', artwork) else None,
            })
        return {'results': results, 'page': page, 'has_more': page * 10 < data.get('found', 0),
                'provider': 'Chorus Encore'}
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        raise ValueError('Chorus Encore search is unavailable right now. Try again shortly or open Chorus Encore directly.') from None
