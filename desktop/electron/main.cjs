const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  net,
  session,
  dialog,
  shell,
  Menu,
} = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Readable } = require("node:stream");
const { pathToFileURL } = require("node:url");
const { Library } = require("./library.cjs");
const { PreparationService, validVideo } = require("./service.cjs");
app.setName("Backstage");
if (process.env.BACKSTAGE_TEST_DATA)
  app.setPath("userData", process.env.BACKSTAGE_TEST_DATA);
protocol.registerSchemesAsPrivileged([
  {
    scheme: "backstage",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
let win, service, library, settings;
let quitting = false;
const origin = "backstage://app";
const devURL = !app.isPackaged && process.env.BACKSTAGE_DEV_URL;
function trusted(url) {
  try {
    const u = new URL(url);
    return (
      (u.protocol === "backstage:" && u.hostname === "app") ||
      (!!devURL && u.origin === new URL(devURL).origin)
    );
  } catch {
    return false;
  }
}
function save() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(
    path.join(app.getPath("userData"), "settings.json"),
    JSON.stringify(settings),
  );
}
function data() {
  return {
    songsRoot: settings.songsRoot,
    python: settings.python,
    serviceAvailable: service.available(),
  };
}
function handle(name, fn) {
  ipcMain.handle("backstage:" + name, async (event, ...args) => {
    if (
      !event.senderFrame ||
      event.senderFrame !== win?.webContents.mainFrame ||
      !trusted(event.senderFrame.url)
    )
      throw Error("Untrusted request.");
    return fn(...args);
  });
}
function text(value, max = 200) {
  if (typeof value !== "string" || value.length > max)
    throw Error("Invalid text.");
  return value.trim();
}
async function createWindow() {
  win = new BrowserWindow({
    title: "Backstage",
    width: 1380,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#101110",
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 20, y: 22 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.on("close", (event) => {
    if (service?.child && !quitting) {
      event.preventDefault();
      app.quit();
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  win.once("ready-to-show", () => win.show());
  await win.loadURL(devURL || origin + "/index.html");
}
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "../..");
  let saved = {};
  try {
    saved = JSON.parse(
      fs.readFileSync(
        path.join(app.getPath("userData"), "settings.json"),
        "utf8",
      ),
    );
  } catch {}
  const configured =
    process.env.BACKSTAGE_SONGS_DIR ||
    saved.songsRoot ||
    path.join(os.homedir(), "Music", "Backstage", "Songs");
  const python =
    process.env.BACKSTAGE_PYTHON ||
    saved.python ||
    (!app.isPackaged
      ? path.join(
          root,
          ".venv",
          process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
        )
      : "");
  settings = {
    songsRoot: path.resolve(configured.replace(/^~(?=$|[\/\\])/, os.homedir())),
    python,
  };
  library = new Library(settings.songsRoot);
  service = new PreparationService({
    source: app.isPackaged
      ? path.join(process.resourcesPath, "song-converter")
      : path.join(root, "song-converter"),
    data: path.join(app.getPath("userData"), "preparation"),
    python,
    songsRoot: settings.songsRoot,
  });
  save();
  protocol.handle("backstage", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "app" || request.method !== "GET")
        return new Response("Not found", { status: 404 });
      if (url.pathname.startsWith("/audio/")) {
        const id = url.pathname.slice(7);
        if (!/^[a-f0-9]{32}$/.test(id))
          return new Response("Not found", { status: 404 });
        const file = await library.audio(id),
          stat = await fsp.stat(file);
        const range = request.headers.get("range");
        let start = 0,
          end = stat.size - 1,
          status = 200;
        if (range) {
          const match = /^bytes=(\d+)-(\d*)$/.exec(range);
          if (!match) return new Response(null, { status: 416 });
          start = Number(match[1]);
          end = match[2] ? Math.min(Number(match[2]), end) : end;
          if (start > end || start >= stat.size)
            return new Response(null, { status: 416 });
          status = 206;
        }
        const mime = {
          ".ogg": "audio/ogg",
          ".opus": "audio/ogg",
          ".mp3": "audio/mpeg",
          ".wav": "audio/wav",
        }[path.extname(file)];
        const headers = {
          "Content-Type": mime,
          "Content-Length": String(end - start + 1),
          "Accept-Ranges": "bytes",
        };
        if (status === 206)
          headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
        return new Response(
          Readable.toWeb(fs.createReadStream(file, { start, end })),
          { status, headers },
        );
      }
      const dist = path.resolve(__dirname, "../dist");
      const file = path.resolve(
        dist,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!file.startsWith(dist + path.sep))
        return new Response("Not found", { status: 404 });
      return await net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response("Unavailable", { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback) =>
      callback(
        trusted(contents.getURL()) &&
          ["midi", "fullscreen"].includes(permission),
      ),
  );
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, requestingOrigin) =>
      !!contents &&
      trusted(contents.getURL()) &&
      trusted(requestingOrigin) &&
      ["midi", "fullscreen"].includes(permission),
  );
  handle("settings", () => data());
  handle("library", () => library.scan());
  handle("loadSong", (id, part, level) => {
    if (
      !["Guitar", "Bass", "Rhythm", "Drums"].includes(part) ||
      !["Easy", "Medium", "Hard", "Expert"].includes(level)
    )
      throw Error("Invalid track.");
    return library.load(text(id, 32), part, level);
  });
  handle("search", (query, provider) => {
    query = text(query);
    if (query.length < 2) throw Error("Enter at least two characters.");
    if (!["youtube", "charts"].includes(provider))
      throw Error("Unknown search provider.");
    return service.request(
      `/api/${provider === "youtube" ? "youtube" : "charts"}/search?q=${encodeURIComponent(query)}`,
    );
  });
  handle("enqueue", (url, title) => {
    const form = new FormData();
    form.set("youtube_url", validVideo(url));
    form.set("title", text(title));
    form.set("lyrics_mode", "skip");
    form.set("art_mode", "offline");
    form.set("charter", "Backstage");
    return service.request("/api/jobs", { method: "POST", body: form });
  });
  handle("queue", () =>
    service.base ? service.request("/api/queue") : service.history(),
  );
  handle("install", (id) => {
    if (!/^[a-f0-9]{32}$/.test(id)) throw Error("Invalid song.");
    return service.request(`/api/jobs/${id}/install`, { method: "POST" });
  });
  handle("importAudio", async () => {
    const choice = await dialog.showOpenDialog(win, {
      title: "Add a song",
      properties: ["openFile"],
      filters: [
        {
          name: "Audio",
          extensions: [
            "mp3",
            "wav",
            "flac",
            "ogg",
            "m4a",
            "opus",
            "aiff",
            "aac",
          ],
        },
      ],
    });
    if (choice.canceled) return null;
    const file = choice.filePaths[0];
    const stat = await fsp.stat(file);
    if (stat.size > 250 * 1024 * 1024)
      throw Error("Choose audio smaller than 250 MB.");
    const form = new FormData();
    form.set(
      "audio",
      new Blob([await fsp.readFile(file)]),
      path.basename(file),
    );
    form.set("lyrics_mode", "skip");
    form.set("art_mode", "offline");
    form.set("charter", "Backstage");
    return service.request("/api/jobs", { method: "POST", body: form });
  });
  handle("chooseLibrary", async () => {
    if (service.child)
      throw Error(
        "Restart Backstage before changing the library while song preparation is running.",
      );
    const choice = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose your Songs library",
    });
    if (choice.canceled) return null;
    settings.songsRoot = choice.filePaths[0];
    library = new Library(settings.songsRoot);
    service.songsRoot = settings.songsRoot;
    save();
    return settings.songsRoot;
  });
  handle("configurePython", async () => {
    if (service.child)
      throw Error(
        "Restart Backstage before changing the running preparation environment.",
      );
    const choice = await dialog.showOpenDialog(win, {
      title: "Select your Backstage Python executable",
      properties: ["openFile", "showHiddenFiles"],
    });
    if (choice.canceled) return false;
    settings.python = choice.filePaths[0];
    service.python = settings.python;
    save();
    return true;
  });
  handle("openPreparation", async () => {
    const base = await service.ensure();
    await shell.openExternal(base);
  });
  handle("openChart", async (value) => {
    const url = text(value, 200);
    if (!/^https:\/\/www\.enchor\.us\/chart\/[a-f0-9]{32}$/.test(url))
      throw Error("Invalid chart link.");
    await shell.openExternal(url);
  });
  handle("showSongs", () => shell.openPath(settings.songsRoot));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Backstage",
        submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "togglefullscreen" },
          ...(!app.isPackaged ? [{ role: "toggleDevTools" }] : []),
        ],
      },
    ]),
  );
  await createWindow();
});
app.on("before-quit", (event) => {
  if (quitting) return;
  if (service?.child) {
    event.preventDefault();
    quitting = true;
    dialog
      .showMessageBox(win, {
        type: "question",
        message: "Close Backstage?",
        detail:
          "Song preparation will stop. Any unfinished conversion must be queued again.",
        buttons: ["Keep open", "Quit"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 1) {
          service.stop();
          app.quit();
        } else quitting = false;
      });
  } else service?.stop();
});
app.on("window-all-closed", () => app.quit());
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
