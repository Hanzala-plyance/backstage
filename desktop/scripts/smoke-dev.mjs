// Dev-mode check: the UI is served by Vite from http://127.0.0.1, a different
// origin from backstage://app, so library covers and audio must still load.
delete process.env.ELECTRON_RUN_AS_NODE;
import { _electron as electron, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import midiPackage from "@tonejs/midi";
const temp = await mkdtemp(path.join(os.tmpdir(), "backstage-dev-"));
let app, server;
try {
  const song = path.join(temp, "songs", "Dev Band - Dev Song");
  await mkdir(song, { recursive: true });
  const midi = new midiPackage.Midi();
  const track = midi.addTrack();
  track.name = "PART GUITAR";
  track.addNote({ midi: 60, time: 1, duration: 0.05 });
  await writeFile(path.join(song, "notes.mid"), midi.toArray());
  await writeFile(
    path.join(song, "song.ini"),
    "[song]\nname=Dev Song\nartist=Dev Band",
  );
  const samples = 22050 * 3,
    wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24);
  wav.writeUInt32LE(44100, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  await writeFile(path.join(song, "song.wav"), wav);
  await writeFile(
    path.join(song, "album.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  server = await createServer({
    server: { host: "127.0.0.1", port: 5179, strictPort: true },
    logLevel: "error",
  });
  await server.listen();
  app = await electron.launch({
    args: [
      ".",
      ...(process.platform === "linux" && process.env.CI
        ? [
            "--no-sandbox",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ]
        : []),
    ],
    env: {
      ...process.env,
      BACKSTAGE_DEV_URL: "http://127.0.0.1:5179",
      BACKSTAGE_TEST_DATA: path.join(temp, "data"),
      BACKSTAGE_SONGS_DIR: path.join(temp, "songs"),
      BACKSTAGE_PYTHON: "",
    },
  });
  const page = await app.firstWindow();
  const blocked = [];
  page.on("console", (m) => {
    if (/Content Security Policy/.test(m.text())) blocked.push(m.text());
  });
  await page.waitForLoadState("domcontentloaded");
  expect(await page.evaluate(() => location.origin)).toBe(
    "http://127.0.0.1:5179",
  );
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Quickplay/ }).click();
  const row = page.getByRole("button", { name: /Dev Song/ });
  await expect
    .poll(() =>
      row.locator(".cover img").evaluate((i) => i.complete && i.naturalWidth),
    )
    .toBe(1);
  const id = await row.getAttribute("data-song-id");
  const played = await page.evaluate(async (id) => {
    const audio = document.createElement("audio");
    audio.src = `backstage://app/audio/${id}`;
    await audio.play();
    await new Promise((r) => setTimeout(r, 400));
    const t = audio.currentTime;
    audio.pause();
    return t;
  }, id);
  expect(played).toBeGreaterThan(0);
  expect(blocked).toEqual([]);
  console.log("PASS: dev mode loads library covers and song audio.");
} finally {
  if (app) await app.close();
  if (server) await server.close();
  await rm(temp, { recursive: true, force: true });
}
