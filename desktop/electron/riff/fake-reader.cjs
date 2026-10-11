// Test stand-in for reader.cjs: no USB, no privileges. Speaks the same socket
// protocol and plays a fixed pattern: receiver 1 cycles orange, receiver 2
// blue (not green or red, which would also drive the menus).
const net = require("net");
const arg = (n) => process.argv[process.argv.indexOf(n) + 1];
const fret = arg("--device").endsWith("2") ? 0x08 : 0x10;
const socket = net.createConnection(arg("--socket"));
const report = (frets, b2 = 0) => {
  const r = Buffer.alloc(16);
  r.write("MRF2");
  r[5] = b2;
  r[8] = frets;
  return r;
};
let on = false;
socket.on("connect", () => {
  const beat = Buffer.alloc(16);
  beat.write("MRFH");
  setInterval(() => socket.write(beat), 500);
  setInterval(() => socket.write(report((on = !on) ? fret : 0)), 400);
});
socket.on("close", () => process.exit(0));
socket.on("error", () => process.exit(1));
