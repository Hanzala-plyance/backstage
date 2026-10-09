"""Live Chorus Encore search plus provider switching and a readable mobile layout."""
from pathlib import Path
from playwright.sync_api import sync_playwright

artifacts = Path(__file__).resolve().parent.parent / '.cache' / 'browser'
artifacts.mkdir(parents=True, exist_ok=True)
with sync_playwright() as w:
    browser = w.chromium.launch(channel='chrome', headless=True)
    page = browser.new_page(viewport={'width':1280, 'height':1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto('http://127.0.0.1:8765')
    page.locator('#source-youtube').click()
    page.locator('#youtube-url').fill('https://youtu.be/jNQXAC9IVRw')
    page.locator('#source-charts').click()
    assert page.locator('#chart-search-panel').is_visible()
    assert page.locator('#build-button').is_hidden()
    assert page.locator('.band-card').is_hidden()
    page.locator('#chart-search-query').fill('Bloc Party Helicopter')
    with page.expect_response(lambda response: '/api/charts/search?' in response.url) as response:
        page.locator('#chart-search-query').press('Enter')
    assert response.value.status == 200, response.value.text()
    page.wait_for_selector('.chart-search-result')
    assert page.locator('.chart-search-result').count() >= 2
    with page.expect_response(lambda response: '/api/charts/search?' in response.url):
        page.locator('#chart-search-instrument').select_option('drums')
    with page.expect_response(lambda response: '/api/charts/search?' in response.url) as response:
        page.locator('#chart-search-difficulty').select_option('easy')
    assert response.value.status == 200
    page.wait_for_function("document.querySelector('#chart-search-status').textContent.includes('shown · Choose a version')")
    row = page.locator('.chart-search-result').filter(has_text='Full Band Upgrade').first
    assert row.is_visible()
    assert 'Drums · Easy, Medium, Hard, Expert' in row.inner_text()
    link = row.get_by_role('link', name='Get Helicopter', exact=False)
    assert link.get_attribute('href').startswith('https://www.enchor.us/chart/')
    assert link.get_attribute('target') == '_blank'
    page.screenshot(path=str(artifacts/'chart-search-desktop.png'), full_page=True)
    page.set_viewport_size({'width':390, 'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(artifacts/'chart-search-mobile.png'), full_page=True)
    page.locator('#source-youtube').click()
    assert page.locator('#youtube-url').input_value() == 'https://youtu.be/jNQXAC9IVRw'
    assert page.locator('#youtube-quality').is_enabled()
    assert page.locator('#build-button').is_visible()
    page.locator('#source-file').click()
    assert page.locator('#audio-file').is_enabled()
    assert not errors, errors
    browser.close()
    print('PASS: live Chorus search, Easy drum filter, chart download link, provider switching, mobile layout.')
