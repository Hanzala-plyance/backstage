import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const {
  pickCover,
  artworkAllowed,
  findCover,
} = require("../electron/covers.cjs");
const { searches } = JSON.parse(
  readFileSync(
    new URL("./fixtures/itunes-search.json", import.meta.url),
    "utf8",
  ),
);
const search = (title: string) => searches.find((s: any) => s.title === title);
test("real catalog results pick the artist's own release", () => {
  const albums: Record<string, string | null> = {
    "Janice STFU": "ICEMAN",
    "One More Time": "Discovery",
    "I Wonder": "Graduation",
    // Only a censored title or an instrumental exists: keep the existing art.
    fukumean: null,
    // The catalog does not have the song; similar titles by others are wrong.
    "Smoke & Drive (feat. blackbear)": null,
  };
  for (const [title, album] of Object.entries(albums)) {
    const s = search(title);
    const url = pickCover(s.results, s.title, s.artist);
    const chosen = s.results.find(
      (r: any) =>
        url &&
        r.artworkUrl100.replace(/\/\d+x\d+bb\.jpg$/, "/600x600bb.jpg") === url,
    );
    assert.equal(chosen?.collectionName ?? null, album, title);
    if (url) assert.match(url, /\/600x600bb\.jpg$/);
  }
});
test("alternate versions and other artists are rejected", () => {
  const r = (
    artistName: string,
    trackName: string,
    collectionName = "Album",
  ) => ({
    kind: "song",
    artistName,
    trackName,
    collectionName,
    artworkUrl100: "https://is1-ssl.mzstatic.com/a/100x100bb.jpg",
  });
  assert.equal(
    pickCover([r("Someone", "Song (Karaoke Version)")], "Song", "Someone"),
    null,
  );
  assert.equal(pickCover([r("Other Band", "Song")], "Song", "Someone"), null);
  assert.equal(
    pickCover([r("Someone", "Different Thing")], "Song", "Someone"),
    null,
  );
  assert.ok(pickCover([r("Someone", "Song (feat. Guest)")], "Song", "Someone"));
  assert.equal(
    pickCover([r("Someone", "Song")], "Song", ""),
    null,
    "needs an artist",
  );
});
test("covers download only from Apple's image CDN as images under 3 MB", async () => {
  assert.ok(artworkAllowed("https://is1-ssl.mzstatic.com/x/600x600bb.jpg"));
  assert.ok(!artworkAllowed("http://is1-ssl.mzstatic.com/x.jpg"));
  assert.ok(!artworkAllowed("https://mzstatic.com.evil.example/x.jpg"));
  const s = search("I Wonder");
  const respond = (body: any, type = "application/json") =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      headers: { "content-type": type },
    });
  const fetchOk = async (url: string) =>
    url.includes("itunes.apple.com")
      ? respond({ results: s.results })
      : respond("jpegbytes", "image/jpeg");
  assert.equal(
    String(await findCover(fetchOk, s.title, s.artist)),
    "jpegbytes",
  );
  const fetchHtml = async (url: string) =>
    url.includes("itunes.apple.com")
      ? respond({ results: s.results })
      : respond("<html>", "text/html");
  assert.equal(await findCover(fetchHtml, s.title, s.artist), null);
});
