delete process.env.ELECTRON_RUN_AS_NODE;
import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile, stat, readdir } from "node:fs/promises";
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
  // A converter-style song in a job-ID folder with a cover: the app should
  // rename it to "Artist - Title" and show the cover.
  const jobFolder = path.join(temp, "songs", "c".repeat(32));
  await mkdir(jobFolder);
  await writeFile(path.join(jobFolder, "notes.mid"), midi.toArray());
  await writeFile(path.join(jobFolder, "song.wav"), wav);
  await writeFile(
    path.join(jobFolder, "song.ini"),
    "[song]\nname=Smoke Band - Renamed Song (Official Video)\nartist=Some Channel",
  );
  await writeFile(
    path.join(jobFolder, ".backstage.json"),
    JSON.stringify({ job_id: "c".repeat(32) }),
  );
  await writeFile(
    path.join(jobFolder, "album.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  app = await electron.launch({
    args: [
      ...(process.env.BACKSTAGE_APP_BINARY ? [] : ["."]),
      // Chromium's synthetic camera: avatar tests never use a real camera.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
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
      // Two fake Riffmaster receivers: same supervisor and socket protocol,
      // no USB and no administrator prompt.
      BACKSTAGE_RIFF_FAKE: "1",
      BACKSTAGE_SONGS_DIR: path.join(temp, "songs"),
      BACKSTAGE_PYTHON: process.env.BACKSTAGE_TEST_SERVICE
        ? process.env.BACKSTAGE_PYTHON
        : "",
    },
  });
  page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const openFullTrack = async () => {
    await page.getByRole("button", { name: "Soundcheck", exact: true }).click();
    await page.getByRole("button", { name: /Full Soundcheck track/ }).click();
  };
  await page.waitForLoadState("domcontentloaded");
  // Only the test's own fake pad (window.__pad) is visible, so a controller
  // attached to the machine running the tests can't press anything.
  await app.context().addInitScript(() => {
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => (window.__pad ? [window.__pad] : []),
    });
  });
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  // Opening flow: title screen, then main menu, then the library.
  await expect(page.locator(".title-screen .press-start")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Quickplay/ })).toBeFocused();
  await expect(
    page.getByRole("button", { name: /Soundcheck Learn to play/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Quickplay/ }).click();
  await expect(
    page.getByRole("heading", { name: "Good music. Great company." }),
  ).toBeVisible();
  // The Soundcheck track lives in Soundcheck, not among library songs.
  await expect(page.locator('.song-row[data-song-id="practice"]')).toHaveCount(
    0,
  );
  // Library tidying: readable folder name, cleaned title, cover served.
  await expect
    .poll(() => readdir(path.join(temp, "songs")))
    .toContain("Smoke Band - Renamed Song");
  const renamedRow = page.getByRole("button", { name: /Renamed Song/ });
  await expect(renamedRow).toContainText("Smoke Band");
  await expect
    .poll(() =>
      renamedRow
        .locator(".cover img")
        .evaluate((img) => img.complete && img.naturalWidth),
    )
    .toBe(1);
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
  await openFullTrack();
  await page.getByRole("button", { name: /Start playing/ }).click();
  // Just before the first note, run the clock at a tenth of real speed so
  // slow machines can't carry it past the hit window (judgment follows it).
  await page.waitForFunction(
    () => window.__testAudio?.currentTime >= 1.6,
    {},
    { timeout: 10000, polling: 10 },
  );
  await page.evaluate(() => (window.__testAudio.playbackRate = 0.1));
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
  await page.getByRole("button", { name: "← Soundcheck" }).click();
  await page.getByRole("button", { name: "Song library", exact: true }).click();
  // Earn and deploy real phrase-based Star Power through the rendered game.
  await page
    .getByRole("button", { name: /Stream fixture Automated test/ })
    .click();
  await page.getByRole("button", { name: /Take the stage/ }).click();
  await page.getByRole("button", { name: /Start playing/ }).click();
  // Notes start at 0.6 s while the stage is still warming up: run the clock at
  // half speed (judgment follows it, so timing rules are unchanged).
  await page.evaluate(() => (window.__testAudio.playbackRate = 0.5));
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
      // Star Power must not change the song's speed.
      expect(await page.evaluate(() => window.__testAudio.playbackRate)).toBe(
        0.5,
      );
    }
  }
  await expect
    .poll(
      async () =>
        await page.locator(".game-metrics > div:first-child b").textContent(),
    )
    .toBe("300");
  // The fixture is 6 s long; keep it from ending before the pause below.
  await page.evaluate(() => (window.__testAudio.playbackRate = 0.1));
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
  });
  await page
    .locator(".device-list")
    .getByRole("button", { name: /Test generic gamepad/ })
    .click();
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
  // Strum releases as soon as focus moves: held past the auto-repeat delay
  // (easy on slow software-rendered frames) it would browse a second row.
  await page.evaluate(() => {
    window.__pad.buttons[13].pressed = true;
    window.addEventListener(
      "focusin",
      () => (window.__pad.buttons[13].pressed = false),
      { once: true },
    );
  });
  await expect(page.locator(".song-row").first()).toBeFocused();
  await tap(7); // Green was remapped to button 7 above; menus follow it.
  await expect(page.locator(".song-dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Take the stage/ }),
  ).toBeFocused();
  await expect(page.locator(".app-hints")).toContainText("Back");
  await tap(1);
  await expect(page.locator(".song-dialog")).toHaveCount(0);
  // Core guitar navigation leads every hint bar; extras follow.
  await expect(page.locator(".app-hints")).toHaveText(
    /Up \/ Down.*Select.*Back.*Remove song.*Next section/,
  );
  await openFullTrack();
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
  await page.getByRole("button", { name: "← Soundcheck" }).click();
  await page.getByRole("button", { name: "Song library", exact: true }).click();
  await page.getByRole("button", { name: /Renamed Song/ }).click();
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
  // Fixture Easy guitar: green at 0.6 s, red at 1.1 s. The first note comes
  // while the stage is still warming up, so run the clock at a fifth of real
  // speed from the start (judgment follows the clock; rules are unchanged).
  await page.evaluate(() => (window.__testAudio.playbackRate = 0.2));
  await page.waitForFunction(
    () => window.__testAudio.currentTime >= 0.57,
    {},
    {
      timeout: 10000,
      polling: 10,
    },
  );
  await page.keyboard.down("a");
  await page.keyboard.press("Space");
  await page.keyboard.up("a");
  // Pads are polled once per frame and software-rendered CI frames can take
  // longer than a hit window. Slow the song clock now (judgment follows it, so
  // rules are unchanged) so that waiting for scores and frames can't carry the
  // song past P1's note.
  await page.evaluate(() => (window.__testAudio.playbackRate = 0.1));
  await expect.poll(scores).toEqual([0, 50]);
  // P1 frets red and strums at once, like a player, just before note 1.
  await page.waitForFunction(
    () => window.__testAudio.currentTime >= 1.1 - 0.05,
    {},
    { timeout: 20000, polling: 10 },
  );
  await page.evaluate(() => {
    window.__pad.buttons[1].pressed = true;
    window.__pad.buttons[13].pressed = true;
  });
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
  // Leaving a game focuses the first song for controller players; let that
  // settle before pointing at another song.
  await expect(page.locator(".song-row").first()).toBeFocused();
  const fixtureRow = page.getByRole("button", { name: /Stream fixture/ });
  // Previews follow real pointer movement, not rows sliding under a resting
  // cursor, so move the mouse onto the row from elsewhere.
  await page.mouse.move(1, 1);
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
  // Finishing a song saves the best result; results show stars and the song
  // details panel shows the saved best.
  const renamed = page.getByRole("button", { name: /Renamed Song/ });
  await renamed.click();
  await page.getByRole("button", { name: /Take the stage/ }).click();
  await page.getByRole("button", { name: /Start playing/ }).click();
  await expect(page.getByRole("heading", { name: "Nice set." })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".game-dialog .stars").first()).toBeVisible();
  await expect(page.locator(".game-dialog .new-best").first()).toBeVisible();
  await page.getByRole("button", { name: "Back to library" }).click();
  await expect(page.locator(".song-row").first()).toBeFocused();
  // Previews follow real pointer movement, not rows sliding under a resting
  // cursor, so move the mouse onto the row from elsewhere.
  await page.mouse.move(1, 1);
  await renamed.hover();
  await expect(page.locator(".song-info h2")).toHaveText("Renamed Song");
  await expect(page.locator(".song-info .part-best").first()).toContainText(
    "Easy",
  );
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
  // Riffmaster guitars, read by Backstage: each receiver is its own controller
  // (fake receivers here). One arriving while Player 1 is on the keyboard
  // becomes Player 1.
  await page.getByRole("button", { name: "Controllers", exact: true }).click();
  await page.getByRole("button", { name: /Keyboard Always ready/ }).click();
  const riff = page.getByLabel("Riffmaster guitars");
  await expect(riff).toContainText("2 receivers plugged in");
  await riff.getByRole("button", { name: "Connect Riffmasters" }).click();
  await expect(riff.locator(".riff-row i.on")).toHaveCount(2, {
    timeout: 10000,
  });
  await expect(page.locator(".toast")).toContainText(
    "PDP Riffmaster 1 is now Player 1",
  );
  // Clone Hero-style join: another controller presses Start, joins as Player 2
  // and sets itself up from its own pop-up. (Its green is button 7, remapped
  // earlier.) Each press is held until its effect shows, then released.
  const hold = async (button, done) => {
    await page.evaluate(
      (b) => (window.__pad.buttons[b].pressed = true),
      button,
    );
    await expect.poll(done, { timeout: 8000 }).toBe(true);
    await page.evaluate(
      (b) => (window.__pad.buttons[b].pressed = false),
      button,
    );
    await frames();
  };
  const setup = page.getByRole("group", { name: "Player 2 setup" });
  // Player 2 is still the keyboard from the band round: leave from the bar.
  const earlier = page.getByRole("button", { name: /^Player 2: / });
  if (await earlier.count()) {
    await earlier.click();
    await setup.getByRole("button", { name: "Leave" }).click();
    await expect(earlier).toHaveCount(0);
  }
  await hold(9, () => setup.isVisible());
  await expect(page.locator(".toast")).toContainText(
    "Test generic gamepad joined as Player 2",
  );
  await hold(13, async () =>
    ((await setup.locator(".setup-row.current").textContent()) ?? "").includes(
      "Difficulty",
    ),
  );
  await hold(
    7,
    async () =>
      (await setup.locator(".setup-row.current strong").textContent()) ===
      "Medium",
  );
  await page.screenshot({ path: "/tmp/backstage-desktop-join.png" });
  await hold(1, async () => (await setup.count()) === 0);
  await expect(
    page.getByRole("button", {
      name: "Player 2: P2, Test generic gamepad, Guitar Medium",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /PDP Riffmaster 1 \(Xbox\)/ }).click();
  // Receiver 1 keeps pressing orange: live input shows button 4.
  await expect(page.locator(".button-meter span").nth(4)).toHaveClass(
    /pressed/,
    { timeout: 5000 },
  );
  await expect(
    page.getByRole("button", { name: /PDP Riffmaster 2 \(Xbox\)/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/backstage-desktop-riffmaster.png",
    fullPage: true,
  });
  // In a song, a guitar nobody is playing says so instead of being ignored.
  await page.getByRole("button", { name: "Song library", exact: true }).click();
  await page.getByRole("button", { name: /Renamed Song/ }).click();
  const soloP2 = page.getByRole("button", { name: "Remove player 2" });
  if (await soloP2.count()) await soloP2.click();
  await expect(page.locator(".song-dialog")).toContainText("PDP Riffmaster 1");
  await page.getByRole("button", { name: /Take the stage/ }).click();
  await page.getByRole("button", { name: /Start playing/ }).click();
  await expect(page.locator(".game-hint")).toContainText(
    "PDP Riffmaster 2 isn’t playing this song",
    { timeout: 8000 },
  );
  // The 4 s fixture may already have finished; either way, leave the stage.
  await page.keyboard.press("Escape");
  const leave = page.getByRole("button", { name: "← Library" });
  if (await leave.count()) await leave.click();
  await page.getByRole("button", { name: "Controllers", exact: true }).click();
  await riff.getByRole("button", { name: "Disconnect Riffmasters" }).click();
  await expect(riff.locator(".riff-row")).toHaveCount(0);
  // Soundcheck: demo-first lessons in their own section. Lessons follow the
  // Controllers selection, so play this one on the keyboard.
  await page.getByRole("button", { name: "Controllers", exact: true }).click();
  await page.getByRole("button", { name: /Keyboard Always ready/ }).click();
  await page.getByRole("button", { name: "Soundcheck", exact: true }).click();
  await expect(page.locator(".lesson-card")).toHaveCount(8);
  // Start runs every step in order, beginning with the controller check.
  await page.getByRole("button", { name: /Start Soundcheck/ }).click();
  await expect(page.locator(".check-count")).toHaveText("0 of 8 working");
  for (const key of ["a", "s", "d", "f", "g", "Space", "Shift", "w"])
    await page.keyboard.press(key);
  await expect(
    page.getByRole("heading", { name: "You’re all set." }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/backstage-desktop-check.png" });
  await page.getByRole("button", { name: /Start the lessons/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Frets & strum" }),
  ).toContainText("press Space to strum");
  await page.getByRole("button", { name: /Watch the demo/ }).click();
  await expect(page.locator(".lesson-badge")).toContainText("DEMO");
  // The game performs the demo through the real rules, so hits count up
  // with no input from the player.
  const lessonHits = async () =>
    Number(
      (
        await page.locator(".lesson-hud div:nth-child(3) b").textContent()
      ).split("/")[0],
    );
  await expect.poll(lessonHits, { timeout: 15000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".lesson-cue")).toContainText("Strum");
  await page.screenshot({ path: "/tmp/backstage-desktop-lesson-demo.png" });
  await page.getByRole("button", { name: /Skip demo/ }).click();
  await expect(
    page.getByRole("heading", { name: "Now you try." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Start →/ }).click();
  // Lesson 1: note i at 3 + i seconds on these lanes.
  const lessonLanes = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 0, 2, 4, 1, 3];
  for (let i = 0; i < lessonLanes.length; i++) {
    await page.waitForFunction(
      (t) => window.__testAudio.currentTime >= t,
      3 + i - 0.03,
      { timeout: 15000, polling: 10 },
    );
    const key = "asdfg"[lessonLanes[i]];
    await page.keyboard.down(key);
    await page.keyboard.press("Space");
    await page.keyboard.up(key);
  }
  await expect(page.getByRole("heading", { name: "Nailed it." })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("button", { name: /Next lesson/ }).click();
  await expect(page.getByRole("dialog", { name: "Chords" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lesson-card").nth(0)).toContainText("Done");
  await expect(page.locator(".lesson-card").nth(1)).toContainText("Done");
  await expect(page.locator(".lesson-card").nth(2)).toContainText("Next up");
  await expect(
    page.getByRole("button", { name: /Continue Soundcheck/ }),
  ).toBeFocused();
  await page.screenshot({
    path: "/tmp/backstage-desktop-soundcheck.png",
    fullPage: true,
  });
  // Avatars: names replace P1–P4; premade or camera avatars play along.
  await page.getByRole("button", { name: "Avatars", exact: true }).click();
  await page.getByRole("textbox", { name: "Player name" }).fill("shredder99");
  await expect(page.getByRole("textbox", { name: "Player name" })).toHaveValue(
    "SHREDDER",
  );
  await page.getByRole("button", { name: /Jinx/ }).click();
  await expect(page.getByRole("button", { name: /Jinx/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("tab", { name: /PLAYER 1/ })).toContainText(
    "SHREDDER",
  );
  // Gear: guitar style and which side of the highway the performer stands.
  await page.getByRole("button", { name: "Single Cut", exact: true }).click();
  await page.getByRole("button", { name: "Left of the highway" }).click();
  await expect(
    page.getByRole("button", { name: "Left of the highway" }),
  ).toHaveAttribute("aria-pressed", "true");
  // Player 2 takes a camera avatar from the fake camera.
  await page.getByRole("tab", { name: /PLAYER 2/ }).click();
  await page.getByRole("button", { name: "Use my camera" }).click();
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await expect
    .poll(() =>
      page
        .getByLabel("Camera preview")
        .evaluate((v) => v.readyState >= 2 && v.videoWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Take photo" }).click();
  await expect(
    page.getByRole("img", { name: "Your avatar photo" }),
  ).toBeVisible({
    timeout: 10000,
  });
  await page.screenshot({ path: "/tmp/backstage-desktop-camera.png" });
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(
    page.getByRole("tab", { name: /PLAYER 2/ }).locator(".portrait img"),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/backstage-desktop-avatars.png",
    fullPage: true,
  });
  // On stage the avatar plays one strum per note hit.
  await page.getByRole("button", { name: "Song library", exact: true }).click();
  await page.getByRole("button", { name: /Renamed Song/ }).click();
  // Names label the lineup: show it with a second player, then play solo.
  const removeP2 = page.getByRole("button", { name: "Remove player 2" });
  if (!(await removeP2.count()))
    await page.getByRole("button", { name: /Add player/ }).click();
  await expect(page.locator(".lineup-row .player-badge").first()).toHaveText(
    "SHREDDER",
  );
  await removeP2.click();
  await page.getByRole("button", { name: /Take the stage/ }).click();
  await page.getByRole("button", { name: /Start playing/ }).click();
  await expect(page.locator(".performer-tag")).toHaveText("SHREDDER");
  await expect(page.locator(".band-stage")).toHaveClass(/side-left/);
  await page.waitForFunction(
    () => window.__testAudio.currentTime >= 0.3,
    {},
    { timeout: 10000, polling: 10 },
  );
  await page.evaluate(() => (window.__testAudio.playbackRate = 0.1));
  await page.waitForFunction(
    () => window.__testAudio.currentTime >= 0.57,
    {},
    { timeout: 10000, polling: 10 },
  );
  await page.keyboard.down("a");
  await page.keyboard.press("Space");
  await page.keyboard.up("a");
  await expect(page.locator(".performer-tag")).toHaveAttribute(
    "data-hits",
    "1",
  );
  await page.screenshot({ path: "/tmp/backstage-desktop-avatar-stage.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "← Library" }).click();
  expect(errors).toEqual([]);
  console.log(
    "PASS: Electron isolation, opening flow, offline library, real practice audio, keyboard score, pause timing, custom mapping, menu navigation, device disconnect pause, two-player input routing, song preview, confirmed song removal, readable folder renaming, album covers, saved best scores with stars, the song details panel, Soundcheck lessons (demo, graded turn, progress), player names and premade/camera avatars on stage, Riffmaster receivers as separate controllers.",
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
