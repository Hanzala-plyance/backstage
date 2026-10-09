"""Hold uploads open to verify adding more songs never waits for existing jobs."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

root=Path(__file__).resolve().parent.parent
artifacts=root/'.cache'/'browser'

async def main():
    async with async_playwright() as w:
        browser=await w.chromium.launch(channel='chrome',headless=True)
        page=await browser.new_page(viewport={'width':1100,'height':900})
        gate=asyncio.Event()
        requests=[]
        ids=[]
        async def hold(route):
            if route.request.method=='POST':
                requests.append(route.request)
                await gate.wait()
            await route.continue_()
        await page.route('**/api/jobs',hold)
        async def accepted(response):
            if response.url.endswith('/api/jobs') and response.request.method=='POST' and response.status==202:
                ids.append((await response.json())['id'])
        page.on('response',accepted)
        await page.goto('http://127.0.0.1:8765')
        for index in range(3):
            if index:
                await page.locator('#queue-add-more').click()
            assert await page.locator('#create-view').is_visible()
            assert await page.locator('#build-button').is_enabled()
            await page.locator('#audio-file').set_input_files(str(artifacts/'Batch verification 1.flac'))
            await page.locator('[name=title]').first.fill(f'Queue availability {index}')
            await page.locator('#lyrics-toggle').uncheck()
            await page.locator('#art-toggle').uncheck()
            await page.locator('#build-button').click()
            await page.wait_for_selector('#queue-panel:not([hidden])')
        await page.wait_for_timeout(300)
        assert len(requests)==2, 'Uploads must be bounded across batches'
        assert await page.locator('.queue-state.uploading').count()==3
        await page.locator('#queue-add-more').click()
        await page.locator('[name=title]').first.fill('Keep this new draft open')
        gate.set()
        for _ in range(240):
            if len(ids)==3:
                statuses=[(await (await page.request.get(f'http://127.0.0.1:8765/api/jobs/{job}')).json()) for job in ids]
                assert not any(s['status']=='error' for s in statuses), statuses
                if all(s['status']=='complete' for s in statuses):
                    break
            await asyncio.sleep(.5)
        else:
            raise AssertionError('Jobs did not finish')
        assert len(requests)==3
        assert await page.locator('#create-view').is_visible(), 'Completion interrupted new-song form'
        assert await page.locator('[name=title]').first.input_value()=='Keep this new draft open'
        titles=[]
        for job in ids:
            result=await (await page.request.get(f'http://127.0.0.1:8765/api/jobs/{job}/result')).json()
            titles.append(result['metadata']['title'])
        assert set(titles)=={f'Queue availability {i}' for i in range(3)}, titles
        (artifacts/'queue-availability-jobs.json').write_text(json.dumps(ids))
        await browser.close()
        print('PASS: add three batches during blocked uploads, maximum two uploads, independent settings, completion preserves new-song draft.',flush=True)

asyncio.run(main())
