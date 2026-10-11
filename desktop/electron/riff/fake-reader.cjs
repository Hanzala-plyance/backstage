// Test stand-in for reader.cjs: no USB, no privileges. Speaks the same socket
// protocol and plays a fixed pattern: receiver 1 cycles orange, receiver 2
// d-pad right (buttons no menu acts on).
const net = require("net");
const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const second = arg("--device").endsWith("2");
const socket = net.createConnection(arg("--socket"));
const report = (on) => {
  const r = Buffer.alloc(16);
  r.write("MRF2");
  r[5] = on && second ? 0x08 : 0;
  r[8] = on && !second ? 0x10 : 0;
  return r;
};
let on = false;
socket.on("connect", () => {
  const beat = Buffer.alloc(16);
  beat.write("MRFH");
  setInterval(() => socket.write(beat), 500);
  setInterval(() => socket.write(report((on = !on))), 400);
});
socket.on("close", () => process.exit(0));
socket.on("error", () => process.exit(1));
