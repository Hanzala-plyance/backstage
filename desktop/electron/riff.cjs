// PDP Riffmaster for Xbox guitars. macOS has no driver for the receiver
// (0e6f:0248), so Backstage drives it itself: `Riffmasters` opens each receiver
// in-process (no separate program), runs the Xbox GIP start-up and decodes
// input, reconnecting when a receiver is replugged.
//
// Fallback: if macOS or another app won't let Backstage open a receiver,
// `AdminBridge` runs the MacRiff-derived reader with administrator rights. It
// streams the same 16-byte reports to private sockets Backstage owns and stops
// (releasing USB) when Backstage disconnects or quits.
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { decode } = require("./riff/decode.cjs");
const {
  receiverKey,
  isReceiver,
  selectReceiver,
  KEY,
} = require("./riff/receivers.cjs");
const { Receiver } = require("./riff/gip.cjs");
const { macriffReaders: liveReaders } = require("./riff/holders.cjs");
// Tests never look at (or stop) real MacRiff processes.
const macriffReaders = () => (fake() ? [] : liveReaders());
const fake = () => !!process.env.BACKSTAGE_RIFF_FAKE;
// Reader scripts and the usb module live outside the asar so plain Node (the
// app's own binary in run-as-node mode) can load them.
const riffDir = path
  .join(__dirname, "riff")
  .replace(/app\.asar(?!\.unpacked)/, "app.asar.unpacked");
function loadUsb() {
  if (fake()) return require("./riff/fake-usb.cjs")();
  try {
    return require("usb");
  } catch (error) {
    console.warn("Riffmaster support unavailable", error);
    return null;
  }
}
/** Receivers plugged in now. Read-only: nothing is opened or claimed. */
function receivers(usb = loadUsb()) {
  if (!usb) return [];
  try {
    return usb.getDeviceList().filter(isReceiver).map(receiverKey).sort();
  } catch {
    return [];
  }
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
/** Administrator fallback: the MacRiff-derived reader as root, over sockets. */
class AdminBridge {
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
    return this.slots.map((s) => {
      // Reports or heartbeats within 3 s: the reader is alive.
      const alive = !!s.client && now - s.last < 3000;
      return {
        key: s.key,
        index: s.index,
        connected: alive && s.reported,
        input: s.reported,
        buttons: s.buttons,
        axes: s.axes,
        state: alive ? "open" : "opening",
        guitar: alive && s.reported ? "connected" : "waiting",
        reason: !alive
          ? "Starting the administrator reader…"
          : s.reported
            ? "Guitar connected (administrator reader)."
            : "Waiting for the guitar. Turn it on and press a button.",
        packets: {},
        quietFor: null,
      };
    });
  }
  status() {
    return {
      receivers: receivers(this.usb),
      connected: this.snapshot(),
      busy: this.dir ? false : macriffActive(),
      active: !!this.dir,
    };
  }
  async connect() {
    await this.disconnect();
    const keys = receivers(this.usb).filter((k) => KEY.test(k));
    if (!keys.length)
      throw new Error(
        "No Riffmaster receivers found. Plug in the receiver and try again.",
      );
    if (macriffActive())
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
const blank = () => ({
  buttons: new Array(16).fill(0),
  axes: [0, 0, 0, 0],
  tilted: false,
  input: false,
});
const EVENTS = 40;
/** Plain-language state of one receiver port, for players and staff. */
function describe(s) {
  if (s.state === "released")
    return "Released. Backstage won't use this receiver until you connect it.";
  if (s.state === "held")
    return "Another program is holding this receiver (often a MacRiff reader left running). Quit it, or ask staff to free the port.";
  if (s.state === "error")
    return s.error || "The receiver could not be opened.";
  if (s.state === "opening") return "Opening the receiver…";
  if (s.state === "closed")
    return "Not connected yet. Choose Connect to use this receiver.";
  if (s.guitar === "connected") return "Guitar connected.";
  return "Waiting for the guitar. Turn it on; if its light stays yellow, choose Reconnect.";
}
/** Riffmasters driven in-process, one slot per USB port. Every receiver
 * found is opened unless a person released it; a guitar only counts as
 * connected once it has announced itself or sent input. */
class Riffmasters {
  constructor(
    onUpdate,
    { usb = loadUsb(), admin, holders = macriffReaders } = {},
  ) {
    this.onUpdate = onUpdate;
    this.usb = usb;
    this.holders = holders;
    this.slots = new Map();
    // Ports a person released: skipped by automatic connection and replugs.
    this.released = new Set();
    this.auto = false;
    this.rescan();
    this.admin = admin ?? new AdminBridge(onUpdate);
    this.admin.usb = usb;
    const hotplug = usb?.usb;
    hotplug?.on?.("attach", (d) => {
      if (!isReceiver(d)) return;
      this.rescan();
      this.log(this.slot(receiverKey(d)), "Receiver plugged in");
      if (this.auto) setTimeout(() => this.connectAll(), 600);
      else this.push();
    });
    hotplug?.on?.("detach", (d) => {
      if (!isReceiver(d)) return;
      this.rescan();
      const s = this.slots.get(receiverKey(d));
      if (!s) return;
      this.log(s, "Receiver unplugged");
      s.receiver?.close();
      this.push();
    });
  }
  slot(key) {
    let s = this.slots.get(key);
    if (!s) {
      // The lowest free index (from 16): two receivers are always
      // Riffmaster 1 and 2, however often they are replugged or macOS
      // renumbers their ports. A port keeps its index while it is plugged in.
      const used = new Set([...this.slots.values()].map((x) => x.index));
      let index = 16;
      while (used.has(index)) index++;
      s = {
        key,
        index,
        receiver: null,
        state: this.released.has(key) ? "released" : "closed",
        guitar: "waiting",
        error: "",
        events: [],
        ...blank(),
      };
      this.slots.set(key, s);
    }
    return s;
  }
  log(slot, text) {
    slot.events.push({ at: Date.now(), text });
    if (slot.events.length > EVENTS) slot.events.shift();
  }
  /** Lists plugged-in receivers. Enumerating USB is slow, so this runs on
   * plug, unplug, connect and status requests, never per guitar report. */
  rescan() {
    this.plugged = receivers(this.usb);
    // Forget ports that are gone (and not open), freeing their index for the
    // next receiver. Released ports are remembered separately.
    const plugged = new Set(this.plugged);
    for (const [key, s] of this.slots)
      if (!plugged.has(key) && !s.receiver && !s.opening)
        this.slots.delete(key);
    return this.plugged;
  }
  /** Ports with a receiver plugged in now (and ports still open). */
  present() {
    const plugged = new Set(this.plugged);
    // Every plugged-in receiver is listed, connected or not.
    plugged.forEach((key) => this.slot(key));
    return [...this.slots.values()]
      .filter((s) => plugged.has(s.key) || s.receiver)
      .sort((a, b) => a.index - b.index);
  }
  snapshot() {
    const now = Date.now();
    return this.present().map((s) => {
      const stats = s.receiver?.stats;
      return {
        key: s.key,
        index: s.index,
        connected: !!s.receiver && s.guitar === "connected",
        input: s.input,
        buttons: s.buttons,
        axes: s.axes,
        error: s.error,
        state: s.state,
        guitar: s.guitar,
        reason: describe(s),
        packets: stats ? { ...stats.packets } : {},
        quietFor:
          stats?.lastPacket && s.guitar === "connected"
            ? now - stats.lastPacket
            : null,
      };
    });
  }
  push() {
    this.onUpdate(this.admin.dir ? this.admin.snapshot() : this.snapshot());
  }
  status() {
    if (this.admin.dir) return { ...this.admin.status(), mode: "admin" };
    this.rescan();
    const connected = this.snapshot();
    return {
      receivers: this.plugged,
      connected,
      active: this.auto,
      mode: "direct",
      denied: connected.some((s) => s.state === "held"),
      busy: macriffActive(this.holders),
    };
  }
  /** Opens one port's receiver. */
  async open(key) {
    const slot = this.slot(key);
    if (slot.receiver || slot.opening) return;
    slot.opening = true;
    slot.state = "opening";
    slot.guitar = "waiting";
    this.push();
    try {
      const device = selectReceiver(this.usb.getDeviceList(), key);
      const receiver = new Receiver(device, {
        onReport: (report) => {
          const state = decode(report, slot.tilted);
          if (!state || state.heartbeat) return;
          Object.assign(slot, state, { input: true });
          this.push();
        },
        onGuitar: () => {
          if (slot.receiver !== receiver) return;
          slot.guitar = "connected";
          this.push();
        },
        onEvent: (text) => this.log(slot, text),
        onClose: (error) => {
          if (slot.receiver !== receiver) return;
          slot.receiver = null;
          slot.guitar = "waiting";
          if (slot.state === "open") {
            slot.state = error ? "error" : "closed";
            slot.error = error
              ? `The receiver stopped: ${error.message ?? error}`
              : "";
          }
          Object.assign(slot, blank());
          this.push();
        },
      });
      // Guitar input can arrive before open() resolves.
      slot.receiver = receiver;
      await receiver.open();
      slot.state = "open";
      slot.error = "";
    } catch (error) {
      slot.receiver = null;
      slot.state = error.denied ? "held" : "error";
      slot.error = error.message;
      this.log(slot, error.message);
    } finally {
      slot.opening = false;
    }
    this.push();
  }
  /** Opens every receiver that isn't open or released. */
  async connectAll() {
    if (!this.usb || this.admin.dir) return this.status();
    this.auto = true;
    for (const key of this.rescan())
      if (!this.released.has(key)) await this.open(key);
    this.push();
    return this.status();
  }
  /** Lets one port go: closes its receiver and keeps it closed. */
  async release(key) {
    this.released.add(key);
    const slot = this.slot(key);
    const r = slot.receiver;
    slot.receiver = null;
    slot.state = "released";
    slot.guitar = "waiting";
    slot.error = "";
    Object.assign(slot, blank());
    if (r) await new Promise((done) => r.close(undefined, done));
    else this.log(slot, "Released");
    this.push();
    return this.status();
  }
  /** Takes one port back (after a release, or to retry a failed open). */
  async connect(key) {
    this.released.delete(key);
    const slot = this.slot(key);
    if (slot.state === "released") slot.state = "closed";
    await this.open(key);
    return this.status();
  }
  /** Closes and reopens one port, resending the Xbox start-up: the fix for a
   * guitar stuck on a yellow light. */
  async reconnect(key) {
    const slot = this.slot(key);
    this.log(slot, "Reconnecting");
    const r = slot.receiver;
    slot.receiver = null;
    Object.assign(slot, blank());
    if (r) await new Promise((done) => r.close(undefined, done));
    return this.connect(key);
  }
  /** Releases every receiver; nothing reconnects until connectAll. Resolves
   * once USB has let go (or after `limit` ms), so quitting never leaves a
   * receiver open for node-usb to close after libusb has shut down. */
  async disconnect(limit = 2000) {
    this.auto = false;
    const closing = [];
    for (const s of this.slots.values()) {
      const r = s.receiver;
      s.receiver = null;
      if (s.state !== "released") s.state = "closed";
      s.guitar = "waiting";
      Object.assign(s, blank());
      if (r) closing.push(new Promise((done) => r.close(undefined, done)));
    }
    let timer;
    await Promise.race([
      Promise.all(closing),
      new Promise((done) => (timer = setTimeout(done, limit))),
    ]);
    clearTimeout(timer);
    await this.admin.disconnect();
    this.push();
    return this.status();
  }
  /** Fallback when receivers can't be opened directly. */
  async useAdmin() {
    await this.disconnect();
    await this.admin.connect();
    return this.status();
  }
  /** Everything needed to debug a controller problem, as plain data. */
  report() {
    let usbList = [];
    try {
      usbList = (this.usb?.getDeviceList() ?? [])
        .filter(isReceiver)
        .map((d) => {
          let configuration = null;
          try {
            configuration = d.configDescriptor?.bConfigurationValue ?? null;
          } catch {}
          return { key: receiverKey(d), configuration };
        });
    } catch {}
    let readers = [];
    try {
      readers = this.holders();
    } catch {}
    return {
      created: new Date().toISOString(),
      platform: `${process.platform} ${process.arch}`,
      versions: {
        electron: process.versions.electron,
        node: process.versions.node,
      },
      mode: this.admin.dir ? "admin" : "direct",
      auto: this.auto,
      receivers: usbList,
      released: [...this.released],
      ports: [...this.slots.values()].map((s) => ({
        key: s.key,
        index: s.index,
        state: s.state,
        guitar: s.guitar,
        reason: describe(s),
        error: s.error,
        packets: s.receiver ? { ...s.receiver.stats.packets } : {},
        lastPacket: s.receiver?.stats.lastPacket
          ? new Date(s.receiver.stats.lastPacket).toISOString()
          : null,
        events: s.events.map((e) => ({
          at: new Date(e.at).toISOString(),
          text: e.text,
        })),
      })),
      macriff: readers,
      admin: this.admin.dir ? this.admin.snapshot() : null,
    };
  }
}
/** A MacRiff session that is still in use (not ended, owner alive). */
function macriffActive(list = macriffReaders) {
  try {
    return list().some((r) => !r.stale);
  } catch {
    return false;
  }
}
module.exports = {
  Riffmasters,
  AdminBridge,
  receivers,
  macriffActive,
};
