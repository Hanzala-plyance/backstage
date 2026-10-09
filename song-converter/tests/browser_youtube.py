"""Live YouTube-to-ZIP check (network required). Run against the local app."""
from io import BytesIO
import json
from pathlib import Path
import zipfile
from playwright.sync_api import sync_playwright

artifacts = Path(__file__).resolve().parent.parent / '.cache' / 'browser'
artifacts.mkdir(parents=True, exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    ids = []
    for video in (False, True):
        page.goto('http://127.0.0.1:8765')
        page.locator('#source-youtube').click()
        page.locator('#youtube-url').fill('https://youtu.be/jNQXAC9IVRw')
        assert page.locator('#youtube-video').is_checked()
        page.locator('#youtube-video').set_checked(video)
        page.locator('#lyrics-toggle').uncheck()
        page.locator('#art-toggle').uncheck()
        page.screenshot(path=str(artifacts / f'youtube-video-{video}.png'), full_page=True)
        with page.expect_response(lambda response: response.url.endswith('/api/jobs') and response.request.method == 'POST') as accepted:
            page.locator('#build-button').click()
        response = accepted.value
        assert response.status == 202, response.text()
        ids.append(response.json()['id'])
        page.locator(f'[data-job="{ids[-1]}"]').get_by_role('button', name='Open', exact=True).click(timeout=180000)
        page.wait_for_selector('#result-panel:not([hidden]), #form-error:not([hidden])', timeout=180000)
        assert page.locator('#form-error').is_hidden(), page.locator('#form-error').inner_text()
        assert page.locator('.track-cell:enabled').count() == 16
        assert page.locator('#video-status').is_visible() == video
        with page.expect_download() as download_event:
            page.locator('#download-button').click()
        download = download_event.value
        assert download.failure() is None
        with zipfile.ZipFile(download.path()) as archive:
            assert any(n.endswith('/notes.mid') for n in archive.namelist())
            assert any(n.endswith('/video.mp4') for n in archive.namelist()) == video
            report = json.loads(archive.read(next(n for n in archive.namelist() if n.endswith('/conversion-report.json'))))
            assert report['source']['type'] == 'YouTube'
            assert report['video']['included'] == video
            assert all(report['validated_tracks']['Drums'].values())
        print(f'PASS: live YouTube import, video={video}, downloaded ZIP, 16 charts; job={ids[-1]}', flush=True)
    (artifacts / 'youtube-test-jobs.json').write_text(json.dumps(ids))
    assert not errors, errors
    browser.close()
