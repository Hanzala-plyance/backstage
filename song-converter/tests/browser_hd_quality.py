"""Verify video quality controls and independent queue settings without downloads."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

artifacts = Path(__file__).resolve().parent.parent / '.cache' / 'browser'
artifacts.mkdir(parents=True, exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 1100})
    errors, submissions = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def accept(route):
        if route.request.method != 'POST':
            route.continue_()
            return
        submissions.append(route.request.method)
        route.fulfill(status=202, content_type='application/json', body=json.dumps({'id': f'{len(submissions):032d}'}))
    page.route('**/api/jobs', accept)
    page.route('**/api/queue', lambda route: route.fulfill(content_type='application/json', body='[]'))
    page.route('**/api/jobs/000000000000000000000000000000*', lambda route: route.fulfill(
        content_type='application/json', body=json.dumps({'status':'processing', 'progress':20, 'message':'Testing queue'})))
    page.add_init_script("""window.sentQualities = [];
      const original = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(body) {
        if (body instanceof FormData) window.sentQualities.push(body.get('youtube_quality'));
        return original.call(this, body);
      };""")
    page.goto('http://127.0.0.1:8765')
    assert page.locator('#youtube-quality').is_disabled()
    page.locator('#source-youtube').click()
    assert page.locator('#youtube-quality').input_value() == '1080'
    assert page.locator('#youtube-quality').is_enabled()
    page.locator('#youtube-video').uncheck()
    assert page.locator('#youtube-quality-option').is_hidden()
    assert page.locator('#youtube-quality').is_disabled()
    page.locator('#youtube-video').check()
    for quality in ('720', 'best'):
        page.locator('#youtube-quality').select_option(quality)
        page.locator('#youtube-url').fill('https://youtu.be/jNQXAC9IVRw')
        with page.expect_response(lambda response: response.url.endswith('/api/jobs') and response.request.method == 'POST'):
            page.locator('#build-button').click()
        page.locator('#queue-add-more').click()
        assert page.locator('#build-button').is_enabled()
    assert page.evaluate('window.sentQualities') == ['720', 'best']
    assert len(submissions) == 2
    page.locator('#source-file').click()
    assert page.locator('#youtube-quality').is_disabled()
    page.locator('#source-youtube').click()
    assert page.locator('#youtube-quality').input_value() == 'best'
    page.screenshot(path=str(artifacts / 'hd-quality-desktop.png'), full_page=True)
    page.set_viewport_size({'width':390, 'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(artifacts / 'hd-quality-mobile.png'), full_page=True)
    assert not errors, errors
    browser.close()
    print('PASS: default Full HD, optional video, source switching, independent queued quality settings, mobile layout.')
