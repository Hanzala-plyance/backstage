// Other programs that may be holding Riffmaster receivers: MacRiff's readers
// run as root and can outlive their session, keeping a receiver (and its
// guitar on a yellow light) away from every other app. Listing is read-only;
// stopping needs administrator approval and is a staff tool.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const READER = /MacRiff\/(reader-group|controller-reader)\.js/;
/** Session directory a reader belongs to, from its config or socket path. */
function sessionOf(args) {
  const config = args.match(/reader-group\.js\s+(\S+)/)?.[1];
  const socket = args.match(/--socket\s+(\S+)/)?.[1];
  const file = config ?? socket;
  if (!file) return null;
  const dir = path.dirname(file);
  // Sockets live in <session>/pN/controller.sock.
  return socket ? path.dirname(dir) : dir;
}
/** MacRiff readers in `ps -Ao pid=,user=,lstart=,command=` output. A reader is
 * stale when its session has ended or its owner process is gone. */
function parseReaders(
  psText,
  {
    readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8")),
    alive = isAlive,
  } = {},
) {
  const readers = [];
  for (const line of psText.split("\n")) {
    // pid user  Day Mon DD HH:MM:SS YYYY  command
    const m = line.match(
      /^\s*(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/,
    );
    if (!m || !READER.test(m[4])) continue;
    const [, pid, user, started, command] = m;
    const session = sessionOf(command);
    let phase = "unknown",
      owner = null;
    try {
      const info = readJson(path.join(session, "session.json"));
      phase = info.phase ?? "unknown";
      owner = info.pid ?? null;
    } catch {
      phase = "missing";
    }
    const ownerGone = owner !== null && !alive(owner);
    readers.push({
      pid: Number(pid),
      user,
      started,
      kind: /reader-group/.test(command) ? "supervisor" : "reader",
      device: command.match(/--device\s+(\S+)/)?.[1] ?? null,
      session,
      phase,
      stale: phase === "stopped" || phase === "missing" || ownerGone,
      reason:
        phase === "stopped"
          ? "Its MacRiff session has ended."
          : phase === "missing"
            ? "Its MacRiff session files are gone."
            : ownerGone
              ? "The program that started it has quit."
              : "MacRiff is using it.",
    });
  }
  return readers;
}
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, owned by someone else (root).
    return error.code === "EPERM";
  }
}
function ps() {
  return (
    spawnSync("/bin/ps", ["-Ao", "pid=,user=,lstart=,command="], {
      encoding: "utf8",
    }).stdout || ""
  );
}
const macriffReaders = () => parseReaders(ps());
/** Stops stale MacRiff readers after one administrator prompt. Re-checks the
 * process list first so only pids that are still stale readers are stopped. */
function stopStaleReaders(
  pids,
  { list = macriffReaders, run = adminKill } = {},
) {
  const stale = new Set(
    list()
      .filter((r) => r.stale)
      .map((r) => r.pid),
  );
  const chosen = pids.filter((pid) => Number.isInteger(pid) && stale.has(pid));
  if (!chosen.length)
    return Promise.resolve({ stopped: [], error: "No stale readers to stop." });
  return run(chosen).then((error) => ({ stopped: error ? [] : chosen, error }));
}
/** `kill` as root via the macOS administrator prompt. Pids are integers that
 * were just verified, passed as separate arguments. */
function adminKill(pids) {
  return new Promise((resolve) => {
    const script = `on run argv
  set commandText to "/bin/kill"
  repeat with p in argv
    set commandText to commandText & " " & quoted form of (p as text)
  end repeat
  do shell script commandText with administrator privileges with prompt "Backstage needs your permission to stop MacRiff readers that are holding Riffmaster receivers."
end run`;
    const child = spawn("/usr/bin/osascript", ["-", ...pids.map(String)], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (d) => (error += d));
    child.stdin.end(script);
    child.on("exit", (code) =>
      resolve(
        code === 0
          ? null
          : /-128|cancel/i.test(error)
            ? "Administrator approval was cancelled."
            : "The readers could not be stopped.",
      ),
    );
    child.on("error", () => resolve("The readers could not be stopped."));
  });
}
module.exports = { parseReaders, macriffReaders, stopStaleReaders };
