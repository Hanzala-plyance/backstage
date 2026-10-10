delete process.env.ELECTRON_RUN_AS_NODE;
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import midiPackage from "@tonejs/midi";
import { execFileSync } from "node:child_process";
const temp = await mkdtemp(path.join(os.tmpdir(), "backstage-smoke-"));
let app, page;
try {
  await mkdir(path.join(temp, "songs"));
  const fixtureFolder = path.join(temp, "songs", "fixture");
  await mkdir(fixtureFolder);
  const midi = new midiPackage.Midi();
  const track = midi.addTrack();
  track.name = "PART GUITAR";
  for (let i = 0; i < 5; i++)
    track.addNote({
      midi: 60 + i,
      time: i === 4 ? 4 : 0.6 + i * 0.5,
      duration: 0.05,
    });
  track.addNote({ midi: 116, time: 0.5, duration: 0.75 });
  track.addNote({ midi: 116, time: 1.5, duration: 0.75 });
  await writeFile(path.join(fixtureFolder, "notes.mid"), midi.toArray());
  await writeFile(
    path.join(fixtureFolder, "song.ini"),
    "[song]\nname=Stream fixture\nartist=Automated test",
  );
  const wav = Buffer.alloc(44 + 22050 * 6 * 2);
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
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < 22050 * 6; i++)
    wav.writeInt16LE(
      Math.round(Math.sin((i / 22050) * 440 * Math.PI * 2) * 4000),
      44 + i * 2,
    );
  await writeFile(path.join(fixtureFolder, "song.wav"), wav);
  app = await electron.launch({
    args: [
      ...(process.env.BACKSTAGE_APP_BINARY ? [] : ["."]),
      ...(process.platform === "linux" && process.env.CI
        ? [
            "--no-sandbox",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--force-device-scale-factor=1",
          ]
        : []),
    ],
    ...(process.env.BACKSTAGE_APP_BINARY
      ? { executablePath: process.env.BACKSTAGE_APP_BINARY }
      : {}),
    env: {
      ...process.env,
      BACKSTAGE_TEST_DATA: path.join(temp, "data"),
      BACKSTAGE_SONGS_DIR: path.join(temp, "songs"),
      BACKSTAGE_PYTHON: process.env.BACKSTAGE_TEST_SERVICE
        ? process.env.BACKSTAGE_PYTHON
        : "",
    },
  });
  page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForLoadState("domcontentloaded");
  // Opening flow: title screen, then main menu, then the library.
  await expect(page.locator(".title-screen .press-start")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Quickplay/ })).toBeFocused();
  await page.getByRole("button", { name: /Quickplay/ }).click();
  await expect(
    page.getByRole("heading", { name: "Good music. Great company." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Soundcheck Practice/ }),
  ).toBeVisible();
  expect(await page.evaluate(() => typeof window.require)).toBe("undefined");
  expect(await page.evaluate(() => typeof window.process)).toBe("undefined");
  const streamed = await page.evaluate(async () => {
    const library = await window.backstage.library();
    const song = library.songs.find((s) => s.title === "Stream fixture");
    const loaded = await window.backstage.loadSong(song.id, "Guitar", "Easy");
    const response = await fetch(loaded.audioUrl, {
      headers: { Range: "bytes=0-43" },
    });
    return {
      status: response.status,
      size: (await response.arrayBuffer()).byteLength,
    };
  });
  expect(streamed).toEqual({ status: 206, size: 44 });
  await page.screenshot({
    path: "/tmp/backstage-desktop-library.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    const Audio = window.Audio;
    window.Audio = class extends Audio {
      constructor(...args) {
        super(...args);
        window.__testAudio = this;
      }
    };
  });
  await page.getByRole("button", { name: /Try the practice track/ }).click();
  await page.getByRole("button", { name: /Take the stage/ }).click();
  await page.getByRole("button", { name: /Start playing/ }).click();
  await page.waitForFunction(
    () => window.__testAudio?.currentTime >= 1.97,
    {},
    { timeout: 10000, polling: 10 },
  );
  await page.keyboard.down("a");
  await page.keyboard.press("Space");
  await page.keyboard.up("a");
  await expect
    .poll(async () =>
      Number(
        await page.locator(".game-metrics > div:first-child b").textContent(),
      ),
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: "/tmp/backstage-desktop-playing.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Paused." })).toBeVisible();
  const before = await page.evaluate(() => window.__testAudio.currentTime);
  await page.waitForTimeout(250);
  expect(
    Math.abs(
      (await page.evaluate(() => window.__testAudio.currentTime)) - before,
    ),
  ).toBeLessThan(0.03);
  await page.screenshot({ path: "/tmp/backstage-desktop-game.png" });
  await page.getByRole("button", { name: "← Library" }).click();
  // Earn and deploy real phrase-based Star Power through the rendered game.
  await page
    .getByRole("button", { name: /Stream fixture Automated test/ })
    .click();
  await page.getByRole("button", { name: /Take the stage/ }).click();
  await page.getByRole("button", { name: /Start playing/ }).click();
  for (let i = 0; i < 5; i++) {
    await page.waitForFunction(
      (target) => window.__testAudio.currentTime >= target,
      i === 4 ? 3.92 : 0.52 + i * 0.5,
      { timeout: 10000, polling: 10 },
    );
    await page.keyboard.down(["a", "s", "d", "f", "g"][i]);
    await page.keyboard.press("Space");
    await page.keyboard.up(["a", "s", "d", "f", "g"][i]);
    if (i === 3) {
      await expect
        .poll(
          async () =>
            await page
              .locator(".power-meter [role=meter]")
              .getAttribute("aria-valuenow"),
        )
        .toBe("50");
      await page.keyboard.press("Shift");
      await expect(page.locator(".game-screen")).toHaveClass(/power-active/);
      await expect(page.locator(".amplifier > strong")).toHaveText("2×");
      expect(await page.evaluate(() => window.__testAudio.playbackRate)).toBe(
        1,
      );
    }
  }
  await expect
    .poll(
      async () =>
        await page.locator(".game-metrics > div:first-child b").textContent(),
    )
    .toBe("300");
  await page.screenshot({ path: "/tmp/backstage-desktop-star-power.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "← Library" }).click();
  await page.getByRole("button", { name: "Controllers", exact: true }).click();
  await page.evaluate(() => {
    window.__pad = {
      index: 0,
      id: "Test generic gamepad",
      connected: true,
      mapping: "",
      buttons: Array.from({ length: 16 }, () => ({
        pressed: false,
        value: 0,
        touched: false,
      })),
      axes: [0, 0],
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => (window.__pad ? [window.__pad] : []),
    });
  });
  await page.getByRole("button", { name: /Test generic gamepad/ }).click();
  await page.locator(".mapping-row").first().getByRole("button").click();
  await page.evaluate(() => (window.__pad.buttons[7].pressed = true));
  await expect(page.locator(".mapping-row").first()).toContainText("Button 7");
  await page.evaluate(() => (window.__pad.buttons[7].pressed = false));
  await page.screenshot({
    path: "/tmp/backstage-desktop-controllers.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Song library", exact: true }).click();
  // Guitar menu navigation: strum to a song, green opens it, red closes it.
  // Hold each press across rendered frames, as a real button would be held;
  // menus poll pads once per frame and slow software rendering stretches frames.
  const frames = () =>
    page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done)),
        ),
    );
  const tap = async (button) => {
    await page.evaluate(
      (b) => (window.__pad.buttons[b].pressed = true),
      button,
    );
    await frames();
    await page.waitForTimeout(50);
    await page.evaluate(
      (b) => (window.__pad.buttons[b].pressed = false),
      button,
    );
    await frames();
  };
  await tap(13);
  await expect(page.locator(".song-row").first()).toBeFocused();
  await tap(7); // Green was remapped to button 7 above; menus follow it.
  await expect(page.locator(".song-dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Take the stage/ }),
  ).toBeFocused();
  await expect(page.locator(".app-hints")).toContainText("Close");
  await tap(1);
  await expect(page.locator(".song-dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Try the practice track/ }).click();
  await page.getByRole("button", { name: /Take the stage/ }).click();
  await page.getByRole("button", { name: /Start playing/ }).click();
  await page.evaluate(() => {
    window.__pad = null;
  });
  await expect(page.getByRole("heading", { name: "Paused." })).toBeVisible();
  await expect(page.locator(".game-dialog")).toContainText(
    "Controller disconnected",
  );
  // Two-player round: P1 is the selected pad, P2 joins on the keyboard.
  // Each player's input must score only on their own highway.
  await page.evaluate(() => {
    window.__pad = {
      index: 0,
      id: "Test generic gamepad",
      connected: true,
      mapping: "",
      buttons: Array.from({ length: 16 }, () => ({
        pressed: false,
        value: 0,
        touched: false,
      })),
      axes: [0, 0],
    };
  });
  await page.getByRole("button", { name: "← Library" }).click();
  await page.getByRole("button", { name: /Try the practice track/ }).click();
  await page.getByRole("button", { name: /Add player/ }).click();
  await expect(
    page.getByRole("button", { name: "Player 2 controller" }),
  ).toHaveText("Keyboard");
  await page.getByRole("button", { name: /Take the stage/ }).click();
  await expect(page.locator(".player-lane")).toHaveCount(2);
  await page.getByRole("button", { name: /Start playing/ }).click();
  const scores = () =>
    page
      .locator(".player-score b")
      .evaluateAll((els) =>
        els.map((e) => Number(e.textContent.replace(/,/g, ""))),
      );
  // Soundcheck Easy: note i at 2 + i * 28/48 s on lane i % 5.
  await page.waitForFunction(
    () => window.__testAudio.currentTime >= 1.97,
    {},
    {
      timeout: 10000,
      polling: 10,
    },
  );
  await page.keyboard.down("a");
  await page.keyboard.press("Space");
  await page.keyboard.up("a");
  await expect.poll(scores).toEqual([0, 50]);
  // P1 strums note 1 (red) on the pad; the remapped green (button 7) is not used.
  // Pads are polled once per frame, and software-rendered CI frames are slow, so
  // run the song clock at quarter speed: the hit window widens in real time
  // while judgment, which follows the song clock, is unchanged.
  await page.evaluate(() => (window.__testAudio.playbackRate = 0.25));
  await page.waitForFunction(
    () => window.__testAudio.currentTime >= 2 + 28 / 48 - 0.04,
    {},
    { timeout: 10000, polling: 10 },
  );
  await page.evaluate(() => (window.__pad.buttons[1].pressed = true));
  await frames();
  await page.evaluate(() => (window.__pad.buttons[13].pressed = true));
  await frames();
  await page.evaluate(() => {
    window.__pad.buttons[1].pressed = false;
    window.__pad.buttons[13].pressed = false;
  });
  await expect.poll(scores).toEqual([50, 50]);
  await page.evaluate(() => (window.__testAudio.playbackRate = 1));
  await page.screenshot({ path: "/tmp/backstage-desktop-multiplayer.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Paused." })).toBeVisible();
  // Library: hovering a song previews its own audio; removal needs confirming
  // and moves the folder out of the library (test trash, not the OS Trash).
  await page.evaluate(() => {
    window.__previews = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__previews.push(this.src);
      return play.call(this);
    };
  });
  await page.getByRole("button", { name: "← Library" }).click();
  const fixtureRow = page.getByRole("button", { name: /Stream fixture/ });
  await fixtureRow.hover();
  const fixtureId = await fixtureRow.getAttribute("data-song-id");
  await expect
    .poll(() => page.evaluate(() => window.__previews))
    .toContain(`backstage://app/audio/${fixtureId}`);
  await fixtureRow.focus();
  await page.keyboard.press("Delete");
  await expect(page.locator(".remove-confirm")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep it" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".remove-confirm")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove from library" }).click();
  await page.getByRole("button", { name: "Remove song" }).click();
  await expect(fixtureRow).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("Removed");
  await stat(path.join(temp, "data", "test-trash", "fixture"));
  await expect(stat(fixtureFolder)).rejects.toThrow();
  if (process.env.BACKSTAGE_TEST_SERVICE) {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page.getByRole("button", { name: "← Library" }).click();
    await page
      .getByRole("button", { name: "Add new songs", exact: true })
      .first()
      .click();
    await page
      .getByRole("textbox", { name: "Search songs", exact: true })
      .fill("Kevin MacLeod");
    await page
      .getByRole("button", { name: "Search songs", exact: true })
      .click();
    await expect(page.locator(".search-result").first()).toBeVisible({
      timeout: 60000,
    });
    await page.screenshot({
      path: "/tmp/backstage-desktop-search.png",
      fullPage: true,
    });
    console.log(
      "PASS: packaged app starts optional service and renders live song search results.",
    );
  }
  expect(errors).toEqual([]);
  console.log(
    "PASS: Electron isolation, opening flow, offline library, real practice audio, keyboard score, pause timing, custom mapping, menu navigation, device disconnect pause, two-player input routing, song preview and confirmed song removal.",
  );
} catch (error) {
  if (page && !page.isClosed()) {
    console.error("Smoke screen:", await page.locator("body").innerText());
    await mkdir("test-results", { recursive: true });
    await page
      .screenshot({ path: "test-results/smoke-failure.png" })
      .catch(() => {});
  }
  throw error;
} finally {
  if (app) await app.close();
  if (process.platform === "darwin" && process.env.BACKSTAGE_APP_BINARY) {
    const bundle = path.resolve(process.env.BACKSTAGE_APP_BINARY, "../../..");
    execFileSync("codesign", ["--verify", "--deep", "--strict", bundle]);
  }
  await rm(temp, { recursive: true, force: true });
}
