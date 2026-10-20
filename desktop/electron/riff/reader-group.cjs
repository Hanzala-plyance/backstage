// One privileged supervisor per Backstage Riffmaster session: restarts a
// reader that fails or stalls, and stops every reader when Backstage's lease
// lapses. Adapted from MacRiff (mac-riff/build/reader-group.js, MIT, cdapayne).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
function json(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function startGroup(entries, session, options = {}) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 4)
    throw new Error("Invalid reader configuration");
  const keys = new Set(),
    sockets = new Set();
  for (const item of entries) {
    if (
      !/^usb:\d+:(\d+(\.\d+)*|address-\d+)$/.test(item.deviceKey) ||
      path.dirname(path.dirname(item.socket)) !== session ||
      keys.has(item.deviceKey) ||
      sockets.has(item.socket)
    )
      throw new Error("Invalid or duplicate receiver");
    keys.add(item.deviceKey);
    sockets.add(item.socket);
  }
  const owner = json(path.join(session, "session.json")).pid;
  if (!Number.isInteger(owner) || owner < 2)
    throw new Error("Missing session owner");
  const lock = path.join(session, "reader-group.lock");
  fs.mkdirSync(lock); // Never run overlapping readers, including manual retries.
  const slots = entries.map((item) => ({
    item,
    dir: path.dirname(item.socket),
    child: null,
    attempts: 0,
    next: 0,
    started: 0,
    healthySince: 0,
  }));
  let stopping = false,
    timer;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });
  function publish(slot, phase, message, extra = {}) {
    slot.phase = phase;
    const file = path.join(slot.dir, "reader-status.json");
    fs.writeFileSync(
      file + ".tmp",
      JSON.stringify({
        phase,
        message,
        attempts: slot.attempts,
        updated: Date.now() / 1000,
        ...extra,
      }),
    );
    fs.renameSync(file + ".tmp", file);
  }
  function finish() {
    if (!stopping || slots.some((s) => s.child)) return;
    clearInterval(timer);
    fs.rmdirSync(lock);
    resolveDone();
  }
  function terminate(slot) {
    const child = slot.child;
    if (!child || slot.killing) return;
    slot.killing = true;
    child.kill("SIGTERM");
    slot.killTimer = setTimeout(
      () => child.kill("SIGKILL"),
      options.killMs ?? 3000,
    );
  }
  function stop() {
    if (stopping) return;
    stopping = true;
    for (const slot of slots) {
      terminate(slot);
      publish(slot, "stopped", "Session ended");
    }
    finish();
  }
  let staleSince = 0;
  function sessionAlive() {
    const state = json(path.join(session, "session.json"));
    const lease = json(path.join(session, "lease.json"));
    if (
      state.pid !== owner ||
      ["stopped", "error"].includes(state.phase) ||
      !alive(owner)
    )
      return false;
    const fresh =
      lease.pid === owner &&
      Date.now() - lease.updated < (options.leaseMs ?? 15000);
    if (fresh) {
      staleSince = 0;
      return true;
    }
    // Allow the owner to resume its timer after Mac sleep before ending the session.
    if (!staleSince) staleSince = Date.now();
    return Date.now() - staleSince < (options.leaseGraceMs ?? 5000);
  }
  function launch(slot) {
    slot.attempts++;
    slot.started = Date.now();
    slot.healthySince = 0;
    slot.killing = false;
    publish(
      slot,
      slot.attempts > 1 ? "reconnecting" : "connecting",
      slot.attempts > 1
        ? "Reconnecting automatically… Keep the receiver in the same USB port."
        : "Connecting receiver…",
    );
    const log = fs.openSync(path.join(slot.dir, "bridge.log"), "a");
    fs.writeSync(
      log,
      `\n[Recovery] ${new Date().toISOString()} attempt ${slot.attempts}\n`,
    );
    const child = spawn(
      options.execPath || process.execPath,
      [
        options.readerPath || path.join(__dirname, "reader.cjs"),
        "--socket",
        slot.item.socket,
        "--device",
        slot.item.deviceKey,
      ],
      { env: options.env || process.env, stdio: ["ignore", log, log] },
    );
    fs.closeSync(log);
    slot.child = child;
    let ended = false;
    function exited(code, error) {
      if (ended) return;
      ended = true;
      clearTimeout(slot.killTimer);
      slot.child = null;
      if (stopping) {
        finish();
        return;
      }
      // A stable reader resets the retry budget; rapid failures back off to 5s.
      const delay = Math.min(
        options.maxDelay ?? 5000,
        (options.baseDelay ?? 500) * 2 ** Math.min(slot.attempts - 1, 4),
      );
      slot.next = Date.now() + delay;
      publish(
        slot,
        "reconnecting",
        "Connection lost. Retrying automatically; reconnect the receiver to the same USB port.",
        { code, error: error?.message, retryAt: slot.next / 1000 },
      );
    }
    child.on("exit", (code) => exited(code));
    child.on("error", (error) => exited(1, error));
  }
  function tick() {
    if (stopping) return;
    if (!sessionAlive()) {
      stop();
      return;
    }
    for (const slot of slots) {
      const retry = path.join(slot.dir, "retry-request");
      if (fs.existsSync(retry)) {
        fs.unlinkSync(retry);
        slot.next = 0;
        if (slot.child) terminate(slot);
      }
      if (!slot.child) {
        if (Date.now() >= slot.next) launch(slot);
        continue;
      }
      const status = json(path.join(slot.dir, "status.json"));
      const fresh =
        status.updated * 1000 >= slot.started &&
        Date.now() - status.updated * 1000 < (options.stallMs ?? 10000);
      if (fresh && status.transportConnected && !slot.killing) {
        const phase = status.connected ? "connected" : "waiting";
        if (slot.phase !== phase)
          publish(
            slot,
            phase,
            status.connected
              ? "Connected · automatic recovery active"
              : "Receiver connected. Turn on the guitar and press a fret.",
          );
        if (!slot.healthySince) slot.healthySince = Date.now();
        if (Date.now() - slot.healthySince > 30000) slot.attempts = 1;
      } else if (Date.now() - slot.started > (options.stallMs ?? 10000)) {
        publish(
          slot,
          "reconnecting",
          "Reader stopped responding. Restarting this player’s connection…",
        );
        terminate(slot);
      }
    }
  }
  timer = setInterval(tick, options.intervalMs ?? 250);
  tick();
  return { stop, done };
}
if (require.main === module) {
  const config = process.argv[2];
  // Tests point at a fake, unprivileged reader; real sessions never set this.
  const readerPath = process.env.BACKSTAGE_RIFF_READER || undefined;
  const group = startGroup(
    JSON.parse(fs.readFileSync(config, "utf8")),
    path.dirname(config),
    { readerPath },
  );
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, group.stop);
  group.done.then(() => process.exit(0));
}
module.exports = { startGroup };
