import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { cleanSong, folderName } = require("../electron/names.cjs");
const cases = JSON.parse(
  readFileSync(new URL("./fixtures/song-names.json", import.meta.url), "utf8"),
);
test("YouTube-style metadata becomes a clean title and artist", () => {
  for (const [[title, artist], [want, wantArtist]] of cases.clean)
    assert.deepEqual(
      cleanSong(title, artist),
      { title: want, artist: wantArtist },
      `${title} / ${artist}`,
    );
});
test("folder names are readable and filesystem-safe", () => {
  for (const [[title, artist], want] of cases.folder)
    assert.equal(folderName(title, artist), want);
  assert.ok(folderName("x".repeat(300), "").length <= 120);
});
