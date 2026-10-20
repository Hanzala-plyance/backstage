// One Riffmaster receiver to one Backstage socket. Runs with administrator
// rights because macOS only lets root claim the receiver's USB interface.
// Adapted from MacRiff's controller mode (mac-riff/build/bridge.js, MIT,
// cdapayne); keyboard injection is not included.
const usb = require("usb");
const { selectReceiver } = require("./receivers.cjs");
const { createOutput } = require("./output.cjs");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : process.argv[i + 1];
};
let device,
  iface,
  endpoint,
  exiting = false;
const output = createOutput(arg("--socket"), cleanupAndExit);
try {
  device = selectReceiver(usb.getDeviceList(), arg("--device"));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
device.open();
usb.usb.on("detach", (removed) => {
  if (
    removed.busNumber === device.busNumber &&
    removed.deviceAddress === device.deviceAddress
  ) {
    console.warn("[USB] Receiver unplugged.");
    cleanupAndExit(1);
  }
});
device.setConfiguration(1, (err) => {
  if (err) {
    console.error(`[USB] Could not configure the receiver: ${err.message}`);
    return cleanupAndExit(1);
  }
  try {
    iface = device.interface(0);
    if (iface.isKernelDriverActive?.()) iface.detachKernelDriver();
    iface.claim();
  } catch (error) {
    console.error(`[USB] Could not claim the receiver: ${error.message}`);
    return cleanupAndExit(1);
  }
  const t = usb.usb.LIBUSB_TRANSFER_TYPE_INTERRUPT;
  endpoint = iface.endpoints.find(
    (e) => e.direction === "in" && e.transferType === t,
  );
  const out = iface.endpoints.find(
    (e) => e.direction === "out" && e.transferType === t,
  );
  if (!endpoint) {
    console.error("[USB] Input endpoint not found.");
    return cleanupAndExit(1);
  }
  // GIP start-up: identify, power on, LED, security, rumble init.
  let sequence = 0;
  const seq = () => (sequence = (sequence + 1) & 0xff || 1);
  let handshaking = false;
  function handshake() {
    if (!out || exiting || handshaking) return;
    handshaking = true;
    const packets = [
      () => [0x04, 0x20, seq(), 0x00],
      () => [0x05, 0x20, seq(), 0x01, 0x00],
      () => [0x0a, 0x20, seq(), 0x03, 0x00, 0x01, 0x14],
      () => [0x06, 0x20, seq(), 0x02, 0x01, 0x00],
      () => [
        0x09,
        0x00,
        seq(),
        0x09,
        0x00,
        0x0f,
        0x00,
        0x00,
        0x00,
        0x00,
        0xff,
        0x00,
        0xeb,
      ],
    ];
    let i = 0;
    (function next() {
      if (exiting || i >= packets.length) return void (handshaking = false);
      out.transfer(Buffer.from(packets[i++]()), (error) => {
        if (error) {
          handshaking = false;
          console.error(`[USB] Handshake failed: ${error.message}`);
          return cleanupAndExit(1);
        }
        setTimeout(next, 20);
      });
    })();
  }
  handshake();
  endpoint.startPoll(1, endpoint.descriptor.wMaxPacketSize);
  endpoint.on("data", (data) => {
    if (data.length < 4) return;
    if (data[0] === 0x02) return handshake(); // guitar (re)announced
    if (data[0] === 0x20) output.send(data);
  });
  endpoint.on("error", (error) => {
    console.error(`[USB] ${error.message}`);
    cleanupAndExit(1);
  });
  console.log("[Reader] Receiver claimed; streaming input.");
});
function cleanupAndExit(code = 0) {
  if (exiting) return;
  exiting = true;
  // A removed device can leave libusb callbacks unresolved: bound cleanup.
  setTimeout(() => process.exit(code), 2000).unref();
  output.close();
  const release = () => {
    if (!iface) {
      try {
        device?.close();
      } catch {}
      return process.exit(code);
    }
    iface.release(true, () => {
      try {
        device.close();
      } catch {}
      process.exit(code);
    });
  };
  try {
    endpoint ? endpoint.stopPoll(release) : release();
  } catch {
    release();
  }
}
process.on("SIGINT", () => cleanupAndExit(0));
process.on("SIGTERM", () => cleanupAndExit(0));
