// Sends complete guitar reports to Backstage over its private socket.
// Adapted from MacRiff (mac-riff/build/controller-output.js, MIT, cdapayne).
const net = require("net");
function createOutput(socketPath, onDisconnect) {
  if (!socketPath) throw new Error("The reader needs --socket PATH");
  const socket = net.createConnection(socketPath);
  let connected = false,
    stopped = false,
    writable = true;
  const pending = [];
  // Heartbeats tell an idle guitar apart from a stalled reader.
  const heartbeat = Buffer.alloc(16);
  heartbeat.write("MRFH");
  const pulse = setInterval(() => {
    if (connected && writable && !pending.length)
      writable = socket.write(heartbeat);
  }, 500);
  socket.on("connect", () => {
    connected = true;
    console.log("[Reader] Connected to Backstage.");
    flush();
  });
  socket.on("drain", () => {
    writable = true;
    flush();
  });
  socket.on("error", (error) => console.error(`[Reader] ${error.message}`));
  socket.on("close", () => {
    clearInterval(pulse);
    if (!stopped) onDisconnect(connected ? 0 : 1);
  });
  function flush() {
    while (connected && writable && pending.length)
      writable = socket.write(pending.shift());
  }
  return {
    send(data) {
      const report = encodeReport(data);
      if (!report) return false;
      // Never coalesce press/release edges: fast strums must survive.
      if (pending.length >= 4096) {
        socket.destroy(new Error("Output stalled; reconnecting."));
        return false;
      }
      pending.push(report);
      flush();
      return true;
    },
    close() {
      stopped = true;
      clearInterval(pulse);
      socket.destroy();
    },
  };
}
/** Xbox One guitar GIP input (0x20) to a 16-byte MRF2 report. Dedicated fret
 * masks avoid the generic button flags shared with the joystick. */
function encodeReport(data) {
  if (
    !Buffer.isBuffer(data) ||
    data.length < 18 ||
    data[0] !== 0x20 ||
    data[1] & 0xc0 ||
    data[3] < 14 ||
    data.length < 4 + data[3]
  )
    return null;
  const report = Buffer.alloc(16);
  report.write("MRF2");
  report[4] = data[4] & 0x0c; // Start (0x04), Select (0x08)
  report[5] = data[5] & 0x0f; // strum up/down, d-pad left/right
  report[6] = data[7]; // whammy
  report[7] = data[6]; // tilt
  report[8] = (data[9] | data[10]) & 0x1f; // both fret rows, green..orange
  report[9] = data[5] & 0x40 && !(data[10] & 0x1f) ? 1 : 0; // stick click
  data.copy(report, 10, 14, 18); // stick X, Y (int16 LE)
  return report;
}
module.exports = { createOutput, encodeReport };
