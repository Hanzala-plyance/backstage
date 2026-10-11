import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  parseReaders,
  stopStaleReaders,
} = require("../electron/riff/holders.cjs");
const PS = `  101 root  Wed Oct  7 21:55:34 2026 /x/MacRiff/bin/node /Users/me/Library/Application Support/MacRiff/reader-group.js /tmp/macriff-band.A/retry-p1.json
  102 root  Wed Oct  7 21:55:34 2026 /x/node /Users/me/Library/Application Support/MacRiff/controller-reader.js --socket /tmp/macriff-band.A/p1/controller.sock --device usb:2:1.2
  201 root  Sat Oct 10 21:40:06 2026 /x/node /Users/me/Library/Application Support/MacRiff/controller-reader.js --socket /tmp/macriff-band.B/p1/controller.sock --device usb:2:1.4
  301 root  Sun Oct 11 09:00:00 2026 /x/node /Users/me/Library/Application Support/MacRiff/controller-reader.js --socket /tmp/macriff-band.C/p1/controller.sock --device usb:2:1.1
  400 me    Sun Oct 11 09:00:00 2026 /usr/bin/vim notes.txt`;
const sessions: Record<string, { phase: string; pid: number }> = {
  "/tmp/macriff-band.A/session.json": { phase: "playing", pid: 9001 },
  "/tmp/macriff-band.B/session.json": { phase: "stopped", pid: 9002 },
  "/tmp/macriff-band.C/session.json": { phase: "playing", pid: 9003 },
};
const options = {
  readJson: (f: string) => {
    if (!sessions[f]) throw new Error("missing");
    return sessions[f];
  },
  alive: (pid: number) => pid === 9003,
};
test("MacRiff readers are found and stale ones told apart", () => {
  const readers = parseReaders(PS, options);
  assert.deepEqual(
    readers.map((r: { pid: number; stale: boolean }) => [r.pid, r.stale]),
    [
      [101, true], // owner gone
      [102, true],
      [201, true], // session stopped
      [301, false], // MacRiff in use
    ],
  );
  assert.equal(readers[0].kind, "supervisor");
  assert.equal(readers[1].device, "usb:2:1.2");
  assert.equal(readers[1].session, "/tmp/macriff-band.A");
  assert.match(readers[2].reason, /session has ended/);
});
test("staff stop only touches pids that are still stale readers", async () => {
  const list = () => parseReaders(PS, options);
  const killed: number[][] = [];
  const run = async (pids: number[]) => {
    killed.push(pids);
    return null;
  };
  const result = await stopStaleReaders([101, 201, 301, 400, 1.5], {
    list,
    run,
  });
  assert.deepEqual(killed, [[101, 201]], "active reader and others skipped");
  assert.deepEqual(result.stopped, [101, 201]);
  const none = await stopStaleReaders([301], { list, run });
  assert.equal(killed.length, 1, "nothing to run");
  assert.match(none.error, /No stale readers/);
  const cancelled = await stopStaleReaders([102], {
    list,
    run: async () => "Administrator approval was cancelled.",
  });
  assert.deepEqual(cancelled.stopped, []);
  assert.match(cancelled.error, /cancelled/);
});
