import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { decode } = require("../electron/riff/decode.cjs");
const { encodeReport } = require("../electron/riff/output.cjs");
const {
  receiverKey,
  selectReceiver,
} = require("../electron/riff/receivers.cjs");
const { RiffSession } = require("../electron/riff.cjs");
const gip = (set: Record<number, number>) => {
  const data = Buffer.alloc(18);
  data[0] = 0x20;
  data[3] = 14;
  for (const [i, v] of Object.entries(set)) data[Number(i)] = v;
  return data;
};
test("GIP guitar input decodes to a standard-layout controller", () => {
  // Green + orange (both fret rows), strum up, Start, whammy half, tilt high.
  const state = decode(
    encodeReport(
      gip({ 4: 0x04, 5: 0x01, 6: 0x90, 7: 0x80, 9: 0x01, 10: 0x10 }),
    ),
  );
  assert.deepEqual(state.buttons.slice(0, 5), [1, 0, 0, 0, 1]);
  assert.equal(state.buttons[12], 1, "strum up");
  assert.equal(state.buttons[13], 0);
  assert.equal(state.buttons[9], 1, "Start");
  assert.equal(state.buttons[8], 1, "tilt drives Star Power");
  assert.ok(Math.abs(state.axes[2] - 0x80 / 255) < 1e-9, "whammy axis");
  // Select alone also gives Star Power; strum down; no tilt.
  const select = decode(encodeReport(gip({ 4: 0x08, 5: 0x02, 6: 0x10 })));
  assert.equal(select.buttons[8], 1);
  assert.equal(select.buttons[13], 1);
  assert.equal(select.tilted, false);
});
test("tilt has hysteresis so it doesn't chatter at the threshold", () => {
  const at = (tilt: number, was: boolean) =>
    decode(encodeReport(gip({ 6: tilt })), was).tilted;
  assert.equal(at(0x70, false), false);
  assert.equal(
    at(0x70, true),
    true,
    "stays on until it drops below the release level",
  );
  assert.equal(at(0x50, true), false);
});
test("malformed packets and heartbeats are not input", () => {
  assert.equal(encodeReport(Buffer.alloc(18)), null);
  assert.equal(encodeReport(gip({ 3: 4 })), null);
  const beat = Buffer.alloc(16);
  beat.write("MRFH");
  assert.deepEqual(decode(beat), { heartbeat: true });
  assert.equal(decode(Buffer.alloc(16)), null);
});
test("receivers are told apart by USB port", () => {
  const dev = (bus: number, ports: number[], pid = 0x0248) => ({
    busNumber: bus,
    portNumbers: ports,
    deviceAddress: 7,
    deviceDescriptor: { idVendor: 0x0e6f, idProduct: pid },
  });
  const list = [dev(2, [1, 1]), dev(2, [1, 2]), dev(2, [1, 3], 0x1234)];
  assert.equal(receiverKey(list[1]), "usb:2:1.2");
  assert.equal(selectReceiver(list, "usb:2:1.2"), list[1]);
  assert.throws(() => selectReceiver(list, "usb:2:1.3"));
});
test("a session streams each receiver separately and releases on disconnect", async () => {
  process.env.BACKSTAGE_RIFF_FAKE = "1";
  let latest: {
    key: string;
    connected: boolean;
    input: boolean;
    buttons: number[];
  }[] = [];
  const session = new RiffSession((pads: typeof latest) => (latest = pads));
  try {
    const status = await session.connect();
    assert.deepEqual(status.receivers, ["usb:9:1", "usb:9:2"]);
    const dir = session.dir;
    // The fake readers press orange on receiver 1 and blue on receiver 2.
    const deadline = Date.now() + 8000;
    while (
      Date.now() < deadline &&
      !(
        latest.length === 2 &&
        latest[0].buttons[0] === 1 &&
        latest[1].buttons[1] === 1
      )
    )
      await new Promise((r) => setTimeout(r, 50));
    assert.equal(latest[0].buttons[4], 1, "receiver 1 orange");
    assert.equal(latest[0].buttons[3], 0, "receiver 1 never sees blue");
    assert.equal(latest[1].buttons[3], 1, "receiver 2 blue");
    assert.ok(latest.every((p) => p.connected && p.input));
    await new Promise((r) => setTimeout(r, 600)); // health is written every 0.5 s
    const health = JSON.parse(fs.readFileSync(`${dir}/p1/status.json`, "utf8"));
    assert.equal(health.transportConnected, true);
    await session.disconnect();
    assert.deepEqual(latest, []);
    // The supervisor saw the session end and released its lock.
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(fs.existsSync(`${dir}/reader-group.lock`), false);
  } finally {
    await session.disconnect();
    delete process.env.BACKSTAGE_RIFF_FAKE;
  }
});
