// PDP Riffmaster for Xbox controllers through the MacRiff reader.
// macOS has no driver for the receiver, so a reader running with
// administrator rights claims each receiver over USB and streams 16-byte
// reports to a private socket that Backstage owns, one per receiver. Backstage
// keeps a lease the supervisor checks: when Backstage disconnects or quits, the
// readers stop and release USB.
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { decode } = require("./riff/decode.cjs");
const { receiverKey, isReceiver, KEY } = require("./riff/receivers.cjs");
const FAKE = ["usb:9:1", "usb:9:2"];
const fake = () => !!process.env.BACKSTAGE_RIFF_FAKE;
// Reader scripts and the usb module live outside the asar so plain Node (the
// app's own binary in run-as-node mode) can load them.
const riffDir = path
  .join(__dirname, "riff")
  .replace(/app\.asar(?!\.unpacked)/, "app.asar.unpacked");
/** Receivers plugged in now. Read-only: nothing is opened or claimed. */
function receivers() {
  if (fake()) return FAKE;
  try {
    const usb = require("usb");
    return usb.getDeviceList().filter(isReceiver).map(receiverKey).sort();
  } catch (error) {
    console.warn("Riffmaster discovery unavailable", error);
    return [];
  }
}
/** MacRiff readers already holding receivers (they would block ours). */
function macriffBusy() {
  if (fake()) return false;
  const ps = spawnSync("/bin/ps", ["-Ao", "command"], { encoding: "utf8" });
  return /MacRiff\/(controller-reader|reader-group)\.js/.test(ps.stdout || "");
}
const writeJson = (file, value) => {
  fs.writeFileSync(file + ".tmp", JSON.stringify(value));
  fs.renameSync(file + ".tmp", file);
};
/** Starts the reader supervisor with administrator rights (one macOS prompt). */
function privileged(config, log) {
  return new Promise((resolve) => {
    // Arguments are passed separately and quoted by AppleScript.
    const script = `on run argv
  set commandText to "/usr/bin/env ELECTRON_RUN_AS_NODE=1 " & quoted form of item 1 of argv & " " & quoted form of item 2 of argv & " " & quoted form of item 3 of argv & " > " & quoted form of item 4 of argv & " 2>&1 < /dev/null &"
  do shell script commandText with administrator privileges with prompt "Backstage needs your permission to connect Riffmaster guitars over USB."
end run`;
    const child = spawn(
      "/usr/bin/osascript",
      [
        "-",
        process.execPath,
        path.join(riffDir, "reader-group.cjs"),
        config,
        log,
      ],
      {
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    let error = "";
    child.stderr.on("data", (d) => (error += d));
    child.stdin.end(script);
    child.on("exit", (code) =>
      resolve(
        code === 0
          ? null
          : /-128|cancel/i.test(error)
            ? "Administrator approval was cancelled."
            : "The Riffmaster reader could not start.",
      ),
    );
    child.on("error", () => resolve("The Riffmaster reader could not start."));
  });
}
/** Tests: the same supervisor, unprivileged, with the fake reader. */
function unprivileged(config, log) {
  const out = fs.openSync(log, "a");
  spawn(process.execPath, [path.join(riffDir, "reader-group.cjs"), config], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      BACKSTAGE_RIFF_READER: path.join(riffDir, "fake-reader.cjs"),
    },
    stdio: ["ignore", out, out],
    detached: false,
  });
  fs.closeSync(out);
  return Promise.resolve(null);
}
/** Removes sessions left by a Backstage that quit before cleaning up. Their
 * readers have already stopped: the supervisor ends when its owner is gone. */
function sweep() {
  for (const name of fs
    .readdirSync("/tmp")
    .filter((n) => n.startsWith("backstage-riff."))) {
    const dir = path.join("/tmp", name);
    try {
      const { pid } = JSON.parse(
        fs.readFileSync(path.join(dir, "session.json"), "utf8"),
      );
      process.kill(pid, 0);
    } catch (error) {
      if (error.code !== "EPERM")
        fs.rm(dir, { recursive: true, force: true }, () => {});
    }
  }
}
class RiffSession {
  constructor(onUpdate, launch = fake() ? unprivileged : privileged) {
    try {
      sweep();
    } catch {}
    this.onUpdate = onUpdate;
    this.launch = launch;
    this.slots = [];
    this.dir = null;
    this.timers = [];
  }
  /** Current state of every connected receiver, for the renderer. */
  snapshot() {
    const now = Date.now();
    return this.slots.map((s) => ({
      key: s.key,
      index: s.index,
      // Reports or heartbeats within 3 s: the reader is alive.
      connected: !!s.client && now - s.last < 3000,
      input: s.reported,
      buttons: s.buttons,
      axes: s.axes,
    }));
  }
  status() {
    return {
      receivers: receivers(),
      connected: this.snapshot(),
      busy: this.dir ? false : macriffBusy(),
      active: !!this.dir,
    };
  }
  async connect() {
    await this.disconnect();
    const keys = receivers().filter((k) => KEY.test(k));
    if (!keys.length)
      throw new Error(
        "No Riffmaster receivers found. Plug in the receiver and try again.",
      );
    if (macriffBusy())
      throw new Error(
        "MacRiff is using the receivers. Stop its session (or quit MacRiff Setup) and try again.",
      );
    const dir = fs.mkdtempSync("/tmp/backstage-riff.");
    fs.chmodSync(dir, 0o700);
    this.dir = dir;
    this.slots = keys.map((key, i) => ({
      key,
      // Stable, out of the way of real gamepads.
      index: 16 + i,
      dir: path.join(dir, `p${i + 1}`),
      client: null,
      last: 0,
      reported: false,
      tilted: false,
      buttons: new Array(16).fill(0),
      axes: [0, 0, 0, 0],
    }));
    for (const slot of this.slots) {
      fs.mkdirSync(slot.dir, { mode: 0o700 });
      slot.socket = path.join(slot.dir, "controller.sock");
      slot.server = net.createServer((client) => this.attach(slot, client));
      await new Promise((resolve, reject) => {
        slot.server.once("error", reject);
        slot.server.listen(slot.socket, resolve);
      });
      fs.chmodSync(slot.socket, 0o600);
    }
    const config = path.join(dir, "controllers.json");
    writeJson(
      config,
      this.slots.map((s, i) => ({
        player: i + 1,
        socket: s.socket,
        deviceKey: s.key,
      })),
    );
    writeJson(path.join(dir, "session.json"), {
      pid: process.pid,
      phase: "ready",
    });
    const lease = () =>
      this.dir &&
      writeJson(path.join(dir, "lease.json"), {
        pid: process.pid,
        updated: Date.now(),
      });
    lease();
    // The supervisor restarts a reader whose status goes stale; report health.
    const health = () => {
      const now = Date.now();
      for (const s of this.slots) {
        const alive = !!s.client && now - s.last < 3000;
        try {
          writeJson(path.join(s.dir, "status.json"), {
            updated: now / 1000,
            transportConnected: alive,
            connected: alive && s.reported,
            gameDetected: true,
          });
        } catch {}
      }
      this.onUpdate(this.snapshot());
    };
    this.timers = [setInterval(lease, 1000), setInterval(health, 500)];
    const error = await this.launch(config, path.join(dir, "readers.log"));
    if (error) {
      await this.disconnect();
      throw new Error(error);
    }
    return this.status();
  }
  attach(slot, client) {
    slot.client?.destroy();
    slot.client = client;
    slot.last = Date.now();
    let pending = Buffer.alloc(0);
    client.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 16) {
        const report = pending.subarray(0, 16);
        pending = pending.subarray(16);
        const state = decode(report, slot.tilted);
        if (!state) continue;
        slot.last = Date.now();
        if (state.heartbeat) continue;
        slot.reported = true;
        slot.tilted = state.tilted;
        slot.buttons = state.buttons;
        slot.axes = state.axes;
        this.onUpdate(this.snapshot());
      }
    });
    const lost = () => {
      if (slot.client !== client) return;
      slot.client = null;
      slot.buttons = new Array(16).fill(0);
      this.onUpdate(this.snapshot());
    };
    client.on("close", lost);
    client.on("error", lost);
  }
  /** Stops the readers (they release USB) and removes the session. */
  async disconnect() {
    const dir = this.dir;
    if (!dir) return;
    this.dir = null;
    this.timers.forEach(clearInterval);
    try {
      writeJson(path.join(dir, "session.json"), {
        pid: process.pid,
        phase: "stopped",
      });
    } catch {}
    for (const s of this.slots) {
      s.client?.destroy();
      s.server?.close();
    }
    this.slots = [];
    this.onUpdate([]);
    // Give the supervisor a moment to see the session end and release USB.
    for (
      let i = 0;
      i < 30 && fs.existsSync(path.join(dir, "reader-group.lock"));
      i++
    )
      await new Promise((r) => setTimeout(r, 100));
    fs.rm(dir, { recursive: true, force: true }, () => {});
  }
}
module.exports = { RiffSession, receivers, macriffBusy };
