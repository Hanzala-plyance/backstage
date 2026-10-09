"""Google Images artwork with explicit, offline-safe fallbacks."""
from io import BytesIO
from pathlib import Path
from functools import lru_cache
import html
import ipaddress
import json
import random
import re
import socket
from urllib.parse import urlencode, urlparse, parse_qs

import httpx
from PIL import Image, ImageDraw, ImageOps

MAX_IMAGE = 12 * 1024 * 1024


def save_image(data: bytes, destination: Path):
    if len(data) > MAX_IMAGE:
        raise ValueError("Cover image must be smaller than 12 MB.")
    with Image.open(BytesIO(data)) as source:
        if source.width * source.height > 25_000_000:
            raise ValueError("Cover image is too large (maximum 25 megapixels).")
        result = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGB"), (768, 768))
        result.save(destination, "PNG")


def public_url(url: str):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Invalid image URL.")
    for address in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)):
        if not ipaddress.ip_address(address[4][0]).is_global:
            raise ValueError("Image URL must point to a public internet address.")


def download_image(client, url: str) -> bytes:
    for _ in range(4):
        public_url(url)
        with client.stream("GET", url, follow_redirects=False) as response:
            if response.is_redirect:
                url = str(response.url.join(response.headers["location"]))
                continue
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if len(data) > MAX_IMAGE:
                    raise ValueError("Image exceeds 12 MB.")
            return bytes(data)
    raise ValueError("Too many image redirects.")


def google_candidates(page: str) -> list[str]:
    urls = []
    # Google embeds originals as JSON tuples. Layouts vary, so also accept imgurl links.
    for match in re.finditer(r'\["(https?://(?:[^"\\]|\\.)+)",\s*\d+,\s*\d+\]', page):
        try:
            url = json.loads('"' + match[1] + '"')
            if not any(host in urlparse(url).netloc for host in ("gstatic.com", "google.com", "googleusercontent.com")):
                urls.append(url)
        except (ValueError, TypeError):
            continue
    for match in re.finditer(r'(?:href|data-href)="([^"]+)"', page):
        query = parse_qs(urlparse(html.unescape(match[1])).query)
        urls.extend(query.get("imgurl", []))
    return list(dict.fromkeys(urls))


@lru_cache(maxsize=64)
def browser_image_candidates(query: str) -> tuple[str, tuple[str, ...]]:
    """Read image search results in a fresh, unsigned-in browser context."""
    from playwright.sync_api import sync_playwright, Error
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(channel='chrome', headless=True)
        except Error:
            try:
                browser = playwright.chromium.launch(headless=True)
            except Error:
                raise ValueError('Install Google Chrome or run: .venv/bin/python -m playwright install chromium') from None
        try:
            page = browser.new_page(locale='en-US', viewport={'width': 1280, 'height': 900})
            page.set_default_timeout(5000)
            page.route('**/*', lambda route: route.abort() if route.request.resource_type in ('media', 'font') else route.continue_())
            searches = [('Google Images', 'https://www.google.com/search?' + urlencode({'q': query, 'udm': '2', 'safe': 'active', 'hl': 'en'})),
                        ('Bing Images', 'https://www.bing.com/images/search?' + urlencode({'q': query, 'adlt': 'strict'}))]
            for source, url in searches:
                try:
                    page.goto(url, wait_until='domcontentloaded', timeout=15000)
                    consent = page.get_by_role('button', name='Reject all', exact=True)
                    if consent.count():
                        consent.first.click()
                    if '/sorry/' in page.url:
                        continue  # Never attempt to solve or bypass Google's challenge.
                    page.wait_for_selector('img', state='attached', timeout=5000)
                    if source == 'Bing Images':
                        candidates = page.locator('a.iusc').evaluate_all("nodes => nodes.flatMap(n => {try {return [JSON.parse(n.getAttribute('m')).murl]} catch {return []}})")
                    else:
                        candidates = google_candidates(page.content())
                    if candidates:
                        return source, tuple(url for url in candidates if isinstance(url, str) and url.startswith(('http://', 'https://')))
                except Error:
                    continue
            raise ValueError('Browser image search is unavailable. Upload a cover or try another search.')
        finally:
            browser.close()


def google_art(query: str, destination: Path) -> dict:
    source, found = browser_image_candidates(query)
    candidates = list(found)
    random.SystemRandom().shuffle(candidates)
    with httpx.Client(timeout=7, headers={"User-Agent": "Mozilla/5.0"}) as client:
        for url in candidates[:4]:
            try:
                save_image(download_image(client, url), destination)
                return {"source": source + ' (Playwright)', "url": url, "query": query}
            except (httpx.HTTPError, ValueError, OSError):
                continue
    raise ValueError("Image search did not return a downloadable image. Upload a cover or try a different search.")


def embedded_art(audio: Path) -> bytes | None:
    from mutagen import File
    media = File(audio)
    if media is None:
        return None
    pictures = getattr(media, "pictures", [])
    if pictures:
        return pictures[0].data
    for value in (media.tags or {}).values():
        if getattr(value, "mime", "").startswith("image/") and hasattr(value, "data"):
            return value.data
    covers = (media.tags or {}).get("covr", [])
    return bytes(covers[0]) if covers else None


def fallback_art(title: str, destination: Path):
    image = Image.new("RGB", (768, 768), "#111713")
    draw = ImageDraw.Draw(image)
    colors = ["#b6f36c", "#f46b6b", "#f4cf61", "#71afff", "#e8a260"]
    for i, color in enumerate(colors):
        x = 140 + i * 120
        draw.line((x, 110, x, 580), fill="#334336", width=3)
        y = 230 + ((sum(map(ord, title)) + i * 83) % 220)
        draw.rounded_rectangle((x - 32, y, x + 32, y + 25), radius=12, fill=color)
    draw.text((80, 650), "AUTOCHART / " + title[:50], fill="#d6e5d3", font_size=23)
    image.save(destination)


def make_art(audio: Path, uploaded: Path | None, destination: Path, title: str, query: str,
             mode: str, warnings: list[str]):
    if uploaded:
        save_image(uploaded.read_bytes(), destination)
        return {"source": "Uploaded cover"}
    if mode == "google":
        try:
            return google_art(query, destination)
        except Exception as exc:
            detail = str(exc) if isinstance(exc, ValueError) else "Network request failed or image search blocked automated access."
            warnings.append("Browser artwork unavailable: " + detail)
    try:
        embedded = embedded_art(audio)
        if embedded:
            save_image(embedded, destination)
            return {"source": "Embedded audio artwork"}
    except (ValueError, OSError):
        pass
    fallback_art(title, destination)
    if mode == "google":
        warnings.append("Used a generated cover because no browser image or embedded artwork was available.")
    return {"source": "Generated fretboard cover"}
