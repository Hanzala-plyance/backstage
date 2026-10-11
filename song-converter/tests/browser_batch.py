"""Batch upload + live YouTube search/queue verification. Requires running app and Chrome."""
from pathlib import Path
import sys
import json
import zipfile
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from songmaker.pipeline import ffmpeg

root = Path(__file__).resolve().parent.parent
artifacts = root / '.cache' / 'browser'
artifacts.mkdir(exist_ok=True, parents=True)
files = []
for index in (1, 2):
    path = artifacts / f'Batch verification {index}.flac'
    ffmpeg(['-i', str(root/'2. Helicopter'/'song.ogg'), '-t', '8', '-c:a', 'flac', str(path)])
    files.append(str(path))
ids = []
with sync_playwright() as w:
    browser = w.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width':1440,'height':1100})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    def capture(response):
        if response.url.endswith('/api/jobs') and response.request.method=='POST' and response.status==202:
            ids.append(response.json()['id'])
    page.on('response', capture)
    page.goto('http://127.0.0.1:8765')
    page.locator('#audio-file').set_input_files(files)
    assert page.locator('#file-selection>div').count()==2
    page.locator('#lyrics-toggle').uncheck()
    page.locator('#art-toggle').uncheck()
    page.locator('#build-button').click()
    page.wait_for_function("[...document.querySelectorAll('.queue-state')].every(el=>!el.classList.contains('uploading'))")
    assert len(ids)==2, ids
    assert page.locator('#queue-panel').is_visible()
    for job in ids[:2]:
        page.locator(f'[data-job="{job}"] a').wait_for(timeout=120000)
    page.reload()
    page.wait_for_selector('#queue-panel:not([hidden])')
    for job in ids[:2]:
        page.locator(f'[data-job="{job}"] a').wait_for()
    page.locator('#queue-add-more').click()
    page.locator('#source-youtube').click()
    page.locator('#youtube-search').fill('Me at the zoo')
    with page.expect_response(lambda r:'/api/youtube/search?' in r.url) as search:
        page.locator('#youtube-search-button').click()
    data=search.value.json()
    assert search.value.status==200, data
    short=[(i,r) for i,r in enumerate(data['results']) if 5< (r['duration'] or 0) < 40]
    assert len(short)>=2, data
    for i,result in short[:2]:
        page.locator('.search-result').nth(i).locator('button').click()
    links=page.locator('#youtube-url').input_value().splitlines()
    assert len(links)==2
    page.locator('#youtube-url').fill('\n'.join(links+['https://example.com/invalid']))
    page.locator('#lyrics-toggle').uncheck()
    page.locator('#art-toggle').uncheck()
    page.locator('#youtube-video').check()
    page.evaluate('window.scrollTo(0,0)')
    page.wait_for_timeout(200)
    page.screenshot(path=str(artifacts/'batch-youtube-search.png'),full_page=True)
    page.locator('#build-button').click()
    page.wait_for_function("[...document.querySelectorAll('.queue-state')].every(el=>!el.classList.contains('uploading'))")
    assert len(ids)==4, ids
    assert page.locator('.queue-state.error').count()>=1
    for job in ids[2:]:
        page.locator(f'[data-job="{job}"] a').wait_for(timeout=180000)
    page.evaluate('window.scrollTo(0,0)')
    page.wait_for_timeout(200)
    page.screenshot(path=str(artifacts/'batch-queue.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(artifacts/'batch-queue-mobile.png'),full_page=True)
    with page.expect_download() as download_event:
        page.locator(f'[data-job="{ids[-1]}"] a').click()
    download=download_event.value
    assert download.failure() is None
    with zipfile.ZipFile(download.path()) as archive:
        assert any(n.endswith('/video.mp4') for n in archive.namelist())
        report=json.loads(archive.read(next(n for n in archive.namelist() if n.endswith('/conversion-report.json'))))
        assert all(report['validated_tracks']['Drums'].values())
        video=next(n for n in archive.infolist() if n.filename.endswith('/video.mp4'))
        assert video.compress_type==zipfile.ZIP_STORED
    page.locator('#queue-add-more').click()
    assert page.locator('#youtube-url').input_value()=='https://example.com/invalid', 'Keep only failed links for retry'
    assert not errors, errors
    (artifacts/'batch-test-jobs.json').write_text(json.dumps(ids))
    print('PASS: two FLACs, live search + two YouTube videos, isolated bad link, queue reload, mobile layout, ZIP with video and drums.',flush=True)
    print('Jobs: '+json.dumps(ids),flush=True)
    browser.close()
