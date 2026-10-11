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
const { Riffmasters, AdminBridge } = require("../electron/riff.cjs");
const { Receiver, STARTUP } = require("../electron/riff/gip.cjs");
const fakeUsb = require("../electron/riff/fake-usb.cjs");
/** Records which buttons each receiver ever pressed, by key. */
const pressed = () => {
  const seen: Record<string, Set<number>> = {};
  const record = (pads: { key: string; buttons: number[] }[]) =>
    pads.forEach((p) =>
      p.buttons.forEach(
        (v, i) => v > 0.5 && (seen[p.key] ??= new Set()).add(i),
      ),
    );
  return { seen, record };
};
const wait = async (check: () => boolean, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end && !check())
    await new Promise((r) => setTimeout(r, 25));
  return check();
};
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
test("administrator fallback streams each receiver over its own socket", async () => {
  process.env.BACKSTAGE_RIFF_FAKE = "1";
  let latest: {
    key: string;
    connected: boolean;
    input: boolean;
    buttons: number[];
  }[] = [];
  const { seen, record } = pressed();
  const session = new AdminBridge((pads: typeof latest) => {
    latest = pads;
    record(pads);
  });
  session.usb = fakeUsb();
  try {
    const status = await session.connect();
    assert.deepEqual(status.receivers, ["usb:9:1", "usb:9:2"]);
    const dir = session.dir;
    // The fake readers press orange on receiver 1, d-pad right on receiver 2.
    assert.ok(
      await wait(
        () => !!seen["usb:9:1"]?.has(4) && !!seen["usb:9:2"]?.has(15),
        10000,
      ),
      "each receiver's own input",
    );
    assert.deepEqual([...seen["usb:9:1"]], [4], "receiver 1 only ever orange");
    assert.deepEqual(
      [...seen["usb:9:2"]],
      [15],
      "receiver 2 only ever d-pad right",
    );
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
test("the receiver driver claims, runs the GIP start-up and decodes input", async () => {
  const usb = fakeUsb();
  const device = usb.devices[0];
  const reports: Buffer[] = [];
  let closed = false;
  const r = new Receiver(device, {
    onReport: (rep: Buffer) => reports.push(rep),
    onClose: () => (closed = true),
  });
  await r.open();
  assert.ok(
    await wait(() => device.sent.length === STARTUP.length),
    "start-up sent",
  );
  assert.deepEqual(
    device.sent.map((p: number[]) => p[0]),
    [0x04, 0x05, 0x0a, 0x06, 0x09],
  );
  assert.deepEqual(
    device.sent.map((p: number[]) => p[2]),
    [1, 2, 3, 4, 5],
    "sequence numbers",
  );
  assert.ok(
    await wait(() => reports.some((rep) => decode(rep).buttons[4] === 1)),
  );
  // A guitar announcing itself again gets the start-up again.
  r.packet(Buffer.from([0x02, 0x20, 0x01, 0x00]));
  assert.ok(await wait(() => device.sent.length === 2 * STARTUP.length));
  r.close();
  assert.ok(await wait(() => closed && !device.opened), "released");
});
test("Backstage reads several receivers itself and reconnects after a replug", async () => {
  const usb = fakeUsb();
  let latest: {
    key: string;
    connected: boolean;
    input: boolean;
    buttons: number[];
    index: number;
  }[] = [];
  const { seen, record } = pressed();
  const riff = new Riffmasters(
    (pads: typeof latest) => {
      latest = pads;
      record(pads);
    },
    { usb },
  );
  const status = await riff.connectAll();
  assert.equal(status.mode, "direct");
  assert.deepEqual(status.receivers, ["usb:9:1", "usb:9:2"]);
  assert.ok(
    await wait(() => !!seen["usb:9:1"]?.has(4) && !!seen["usb:9:2"]?.has(15)),
    "each receiver's own input",
  );
  assert.deepEqual([...seen["usb:9:1"]], [4], "receiver 1 only ever orange");
  assert.deepEqual(
    latest.map((p) => p.index),
    [16, 17],
  );
  // Unplug receiver 2: it leaves the list; receiver 1 keeps playing.
  usb.devices[1].unplugged = true;
  usb.usb.emit("detach", usb.devices[1]);
  assert.ok(await wait(() => latest.length === 1 && latest[0].connected));
  // Plug it back in: it reconnects on its own, same index.
  usb.devices[1].unplugged = false;
  usb.usb.emit("attach", usb.devices[1]);
  assert.ok(
    await wait(() => !!latest[1]?.connected && latest[1].buttons[15] === 1),
  );
  assert.equal(latest[1].index, 17);
  await riff.disconnect();
  assert.ok(latest.every((p) => !p.connected));
  assert.ok(
    usb.devices.every((d: { opened: boolean }) => !d.opened),
    "receivers released",
  );
});
test("a receiver another app holds is reported, not retried in a loop", async () => {
  const usb = fakeUsb();
  usb.devices[0].open = () => {
    throw new Error("LIBUSB_ERROR_ACCESS");
  };
  let latest: { connected: boolean; error?: string }[] = [];
  const riff = new Riffmasters((pads: typeof latest) => (latest = pads), {
    usb,
  });
  const status = await riff.connectAll();
  assert.equal(status.denied, true);
  assert.equal(latest[0].connected, false);
  assert.equal((latest[0] as { state?: string }).state, "held");
  assert.match(
    (latest[0] as { reason?: string }).reason ?? "",
    /holding this receiver/,
  );
  assert.ok(
    await wait(() => latest[1]?.connected),
    "the other receiver still works",
  );
  await riff.disconnect();
});

type Port = {
  key: string;
  index: number;
  connected: boolean;
  state: string;
  guitar: string;
  reason: string;
  packets: Record<string, number>;
};
test("a receiver counts as a guitar only once the guitar talks", async () => {
  const silent = fakeUsb.receiver(1, 0x01, 0, { guitar: false });
  const usb = fakeUsb([silent]);
  let latest: Port[] = [];
  const riff = new Riffmasters((pads: Port[]) => (latest = pads), { usb });
  await riff.connectAll();
  assert.equal(latest[0].state, "open");
  assert.equal(latest[0].guitar, "waiting");
  assert.equal(latest[0].connected, false, "no phantom guitar");
  assert.match(latest[0].reason, /Waiting for the guitar/);
  silent.pairGuitar();
  assert.ok(await wait(() => latest[0].connected));
  assert.equal(latest[0].guitar, "connected");
  assert.ok(await wait(() => (latest[0].packets["0x20"] ?? 0) > 0));
  assert.equal(latest[0].packets["0x02"], 1);
  await riff.disconnect();
});
test("an already configured receiver is not reset when opened", async () => {
  const configured = fakeUsb.receiver(1, 0x01);
  configured.configured = 1;
  const fresh = fakeUsb.receiver(2, 0x02);
  const riff = new Riffmasters(() => {}, { usb: fakeUsb([configured, fresh]) });
  await riff.connectAll();
  assert.equal(configured.configurations, 0, "left alone");
  assert.equal(fresh.configurations, 1);
  await riff.disconnect();
});
test("a released port stays released through replugs until connected", async () => {
  const usb = fakeUsb();
  let latest: Port[] = [];
  const riff = new Riffmasters((pads: Port[]) => (latest = pads), { usb });
  await riff.connectAll();
  assert.ok(await wait(() => latest.every((p) => p.connected)));
  const [first, second] = latest.map((p) => p.key);
  await riff.release(first);
  const port = () => latest.find((p) => p.key === first)!;
  assert.equal(port().state, "released");
  assert.equal(port().connected, false);
  assert.equal(usb.devices[0].opened, false, "USB let go");
  assert.ok(latest.find((p) => p.key === second)!.connected, "other port kept");
  // Automatic connection and a replug both leave it alone.
  await riff.connectAll();
  usb.devices[0].unplugged = true;
  usb.usb.emit("detach", usb.devices[0]);
  usb.devices[0].unplugged = false;
  usb.usb.emit("attach", usb.devices[0]);
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(port().state, "released");
  assert.equal(usb.devices[0].opened, false);
  await riff.connect(first);
  assert.ok(await wait(() => port().connected));
  assert.equal(port().index, 16, "same index after release");
  await riff.disconnect();
});
test("reconnect reopens one port and resends the Xbox start-up", async () => {
  const usb = fakeUsb();
  let latest: Port[] = [];
  const riff = new Riffmasters((pads: Port[]) => (latest = pads), { usb });
  await riff.connectAll();
  assert.ok(await wait(() => latest.every((p) => p.connected)));
  const before = usb.devices[0].sent.length;
  await riff.reconnect(latest[0].key);
  assert.ok(
    await wait(() => usb.devices[0].sent.length >= before + STARTUP.length),
  );
  assert.ok(await wait(() => latest[0].connected));
  const report = riff.report();
  const events = report.ports[0].events.map((e: { text: string }) => e.text);
  assert.ok(events.includes("Reconnecting"));
  assert.ok(
    events.filter((t: string) => t === "Sent Xbox start-up").length >= 2,
  );
  assert.deepEqual(
    report.receivers.map((r: { key: string }) => r.key),
    latest.map((p) => p.key),
  );
  await riff.disconnect();
});
