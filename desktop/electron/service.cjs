const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const os = require("node:os");
class PreparationService {
  constructor({ source, data, python, songsRoot }) {
    Object.assign(this, { source, data, python, songsRoot });
    this.child = null;
    this.base = null;
    this.starting = null;
    this.error = "";
    this.stopping = false;
  }
  available() {
    return !!this.python && fs.existsSync(this.python);
  }
  async ensure() {
    if (this.base) return this.base;
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }
  async start() {
    if (!this.available())
      throw Error(
        "Song preparation needs Python setup. Open Settings and select the Python executable from your Backstage environment. Local songs still work.",
      );
    const port = await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const p = server.address().port;
        server.close(() => resolve(p));
      });
    });
    const base = `http://127.0.0.1:${port}`;
    fs.mkdirSync(this.data, { recursive: true });
    this.error = "";
    const env = {
      ...process.env,
      BACKSTAGE_SONGS_DIR: this.songsRoot,
      BACKSTAGE_OUTPUT_DIR: path.join(this.data, "output"),
      BACKSTAGE_CACHE_DIR: path.join(this.data, "cache"),
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PATH: [
        path.dirname(this.python),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        process.env.PATH,
      ]
        .filter(Boolean)
        .join(path.delimiter),
    };
    const child = spawn(
      this.python,
      [
        path.join(this.source, "run.py"),
        "--no-browser",
        "--port",
        String(port),
      ],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child = child;
    const log = fs.createWriteStream(path.join(this.data, "service.log"), {
      flags: "w",
    });
    child.stdout.on("data", (chunk) => log.write(chunk));
    child.stderr.on("data", (chunk) => {
      log.write(chunk);
      this.error = (this.error + chunk.toString()).slice(-3000);
    });
    child.once("error", (error) => {
      this.error = error.message;
    });
    child.once("exit", () => {
      if (this.child === child) {
        this.base = null;
        this.child = null;
      }
      log.end();
    });
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null || child.signalCode || !child.pid)
        throw Error(
          "Song preparation could not start. Select a Python environment with song-converter/requirements.txt installed. See the service log in application data.",
        );
      try {
        const response = await fetch(base + "/api/health", {
          signal: AbortSignal.timeout(500),
        });
        const status = await response.json();
        if (
          status.product === "Backstage" &&
          fs.realpathSync(status.output) ===
            fs.realpathSync(env.BACKSTAGE_OUTPUT_DIR)
        ) {
          this.base = base;
          return base;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    child.kill();
    throw Error(
      "Song preparation did not become ready. Check your Python environment and try again.",
    );
  }
  async request(route, options = {}) {
    const base = await this.ensure();
    const response = await fetch(base + route, {
      ...options,
      signal: AbortSignal.timeout(60000),
    });
    const value = await response.json();
    if (!response.ok)
      throw Error(
        typeof value.detail === "string"
          ? value.detail
          : "Song preparation failed.",
      );
    return value;
  }
  history() {
    const output = path.join(this.data, "output");
    if (!fs.existsSync(output)) return [];
    const entries = [];
    for (const id of fs
      .readdirSync(output)
      .filter((id) => /^[a-f0-9]{32}$/.test(id))) {
      try {
        const folder = path.join(output, id);
        if (fs.lstatSync(folder).isSymbolicLink()) continue;
        const read = (name) =>
          JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"));
        const record = read("job.json");
        if (fs.existsSync(path.join(folder, "result.json"))) {
          let library = {
            status: "not-installed",
            message: "Ready to install.",
          };
          if (fs.existsSync(path.join(folder, "library.json")))
            library = read("library.json");
          if (library.status === "installed" && !fs.existsSync(library.path))
            library = {
              status: "missing",
              message: "Installed folder is missing. Retry installation.",
            };
          entries.push({
            ...record,
            status: "complete",
            progress: 100,
            library,
            message: library.message,
          });
        } else {
          const error = fs.existsSync(path.join(folder, "error.json"))
            ? read("error.json")
            : {
                message:
                  "Preparation stopped before this song finished. Re-add it to try again.",
              };
          entries.push({
            ...record,
            status: "error",
            progress: 0,
            message: error.message,
          });
        }
      } catch {
        /* A damaged history record must not prevent local gameplay. */
      }
    }
    return entries.sort((a, b) => a.created_at - b.created_at).slice(-100);
  }
  stop() {
    this.stopping = true;
    if (this.child) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
    this.base = null;
  }
}
function validVideo(value) {
  if (typeof value !== "string" || value.length > 2048)
    throw Error("Paste a YouTube video URL.");
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("Paste a YouTube video URL.");
  }
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.port
  )
    throw Error("Invalid video URL.");
  let id;
  if (["youtu.be", "www.youtu.be"].includes(u.hostname))
    id = u.pathname.slice(1);
  else if (
    [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "music.youtube.com",
    ].includes(u.hostname)
  )
    id = u.searchParams.get("v");
  if (!/^[\w-]{11}$/.test(id || ""))
    throw Error("Use a link to one YouTube video.");
  return "https://www.youtube.com/watch?v=" + id;
}
module.exports = { PreparationService, validVideo };
