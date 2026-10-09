"""Real browser upload, full-band verification, and editing. Requires running app + Chrome."""
from pathlib import Path
from io import BytesIO
import json
import zipfile
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import mido
from playwright.sync_api import sync_playwright
from songmaker.pipeline import ffmpeg

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / '.cache' / 'browser'
ARTIFACTS.mkdir(parents=True, exist_ok=True)
source = ARTIFACTS / 'Apple Lossless test.m4a'
ffmpeg(['-i', str(ROOT / '2. Helicopter' / 'song.ogg'), '-t', '18', '-c:a', 'alac', str(source)])
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1100}, device_scale_factor=1)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:8765')
    page.wait_for_selector('#song-form')
    page.locator('#source-youtube').click()
    assert page.locator('#youtube-video').is_visible()
    assert page.locator('#youtube-video').is_checked()
    assert page.locator('#cover-video-option').is_hidden()
    assert page.locator('#audio-file').is_disabled()
    page.locator('#youtube-video').check()
    page.locator('#youtube-url').fill('https://example.com/not-youtube')
    page.locator('#build-button').click()
    page.wait_for_selector('#form-error:not([hidden])')
    assert 'YouTube' in page.locator('#form-error').inner_text()
    page.screenshot(path=str(ARTIFACTS / 'youtube-desktop.png'), full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'YouTube mobile overflow'
    page.screenshot(path=str(ARTIFACTS / 'youtube-mobile.png'), full_page=True)
    page.set_viewport_size({'width':1440,'height':1100})
    page.locator('#queue-add-more').click()
    page.locator('#source-file').click()
    assert page.locator('#youtube-video').is_disabled()
    assert page.locator('#cover-video-option').is_visible()
    page.screenshot(path=str(ARTIFACTS / 'desktop.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile overflow'
    page.screenshot(path=str(ARTIFACTS / 'mobile.png'), full_page=True)
    page.set_viewport_size({'width': 1440, 'height': 1100})
    page.locator('#audio-file').set_input_files(str(source))
    page.locator('[name=title]').first.fill('Full band verification')
    page.locator('[name=artist]').first.fill('Autochart test')
    page.locator('[name=model]').select_option('tiny')
    page.locator('#art-toggle').uncheck()
    with page.expect_response(lambda r: r.url.endswith('/api/jobs') and r.request.method=='POST') as accepted:
        page.locator('#build-button').click()
    job_id=accepted.value.json()['id']
    print('Submitted actual ALAC audio.', flush=True)
    page.locator(f'[data-job="{job_id}"]').get_by_role('button', name='Open', exact=True).click(timeout=180000)
    page.wait_for_selector('#result-panel:not([hidden]), #form-error:not([hidden])', timeout=180000)
    assert page.locator('#form-error').is_hidden(), page.locator('#form-error').inner_text()
    assert page.locator('.track-cell:enabled').count() == 16
    assert page.locator('#volume-status').is_visible()
    assert 'Volume matched' in page.locator('#volume-status').inner_text()
    page.locator('#drums-help-button').click()
    page.wait_for_selector('#drums-check-status.verified')
    assert 'Easy:' in page.locator('#drums-check-status').inner_text()
    page.screenshot(path=str(ARTIFACTS / 'drums-help.png'), full_page=True)
    page.locator('#close-drums').click()
    for instrument in ('Guitar','Bass','Rhythm','Drums'):
        for level in ('Easy','Medium','Hard','Expert'):
            page.locator(f'[data-instrument="{instrument}"][data-difficulty="{level}"]').click()
            assert page.locator('#preview-title').inner_text() == f'{instrument} · {level}'
    page.locator('[data-instrument="Drums"][data-difficulty="Easy"]').click()
    page.locator('#edit-notes').check()
    canvas = page.locator('#chart-preview')
    box = canvas.bounding_box()
    canvas.click(position={'x': (93 + 3.13 * 787/5) / 900 * box['width'], 'y': 97.5 / 300 * box['height']})
    page.locator('#save-track').click()
    page.wait_for_function("document.querySelector('#track-edit-status').textContent.startsWith('Saved.')")
    page.locator('[data-tab=lyrics]').click()
    page.locator('#audio-player').evaluate('(audio) => {audio.currentTime = 2;}')
    page.locator('#add-lyric').click()
    page.locator('.lyric-row input').nth(1).fill('Updated test lyric')
    page.locator('#save-lyrics').click()
    page.wait_for_function("document.querySelector('#lyrics-save-message').textContent.includes('ZIP')")
    page.locator('[data-tab=details]').click()
    page.locator('#details-form [name=title]').fill('Full band verified')
    page.locator('#details-form button').click()
    page.wait_for_function("document.querySelector('#result-title').textContent === 'Full band verified'")
    page.locator('#replace-cover').set_input_files(str(ROOT / '2. Helicopter' / 'album.png'))
    page.wait_for_function("document.querySelector('#art-source').textContent.includes('Uploaded cover')")
    page.locator('[data-tab=notes]').click()
    page.locator('#edit-notes').uncheck()
    page.locator('#audio-player').evaluate('(audio) => {audio.currentTime = 3;}')
    page.wait_for_timeout(300)
    page.screenshot(path=str(ARTIFACTS / 'result.png'), full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Editor mobile overflow'
    page.screenshot(path=str(ARTIFACTS / 'result-mobile.png'), full_page=True)
    with page.expect_download() as download_info:
        page.locator('#download-button').click()
    download = download_info.value
    assert download.failure() is None
    with zipfile.ZipFile(download.path()) as archive:
        chart = next(n for n in archive.namelist() if n.endswith('/notes.mid'))
        assert not any(n.endswith('/notes.chart') for n in archive.namelist())
        midi = mido.MidiFile(file=BytesIO(archive.read(chart)), charset='utf-8')
        for name in ('PART GUITAR','PART BASS','PART RHYTHM','PART DRUMS'):
            track = next(t for t in midi.tracks if t.name == name)
            for base in (60,72,84,96):
                assert any(m.type=='note_on' and m.velocity and base <= m.note <= base+4 for m in track), (name,base)
        assert any(m.type=='lyrics' and m.text=='Updated test lyric' for t in midi.tracks for m in t)
    page.locator('#library-button').click()
    page.wait_for_selector('.library-entry')
    page.locator('.library-entry', has_text='Full band verified').first.click()
    page.wait_for_selector('#result-panel:not([hidden])')
    assert page.locator('.track-cell:enabled').count() == 16
    assert not errors, errors
    print('PASS: 16 charts, ALAC upload, note/lyric/metadata/cover editing, mobile layouts, library, MIDI ZIP.', flush=True)
    browser.close()
