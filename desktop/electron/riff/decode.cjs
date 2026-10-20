// MRF2 report to a standard-layout virtual controller, so Backstage's default
// pad mapping plays a Riffmaster with no setup:
// buttons 0-4 frets, 6 whammy (pressed past a third), 8 Select or tilt (Star
// Power), 9 Start, 10 stick click, 12/13 strum up/down, 14/15 d-pad left/right;
// axes 0/1 stick, 2 whammy, 3 tilt (0 at rest to 1).
const BUTTONS = 16;
// Tilt hysteresis, as in MacRiff, so a guitar held near the threshold doesn't
// chatter between on and off.
const TILT_ON = 0x80,
  TILT_OFF = 0x58;
function decode(report, previousTilted = false) {
  if (!Buffer.isBuffer(report) || report.length !== 16) return null;
  const tag = report.toString("latin1", 0, 4);
  if (tag === "MRFH") return { heartbeat: true };
  if (tag !== "MRF2") return null;
  const b1 = report[4],
    b2 = report[5],
    whammy = report[6] / 255,
    tiltRaw = report[7],
    frets = report[8];
  const tilted = tiltRaw >= (previousTilted ? TILT_OFF : TILT_ON);
  const buttons = new Array(BUTTONS).fill(0);
  for (let i = 0; i < 5; i++) buttons[i] = frets & (1 << i) ? 1 : 0;
  buttons[6] = whammy;
  buttons[8] = b1 & 0x08 || tilted ? 1 : 0;
  buttons[9] = b1 & 0x04 ? 1 : 0;
  buttons[10] = report[9] ? 1 : 0;
  buttons[12] = b2 & 0x01 ? 1 : 0;
  buttons[13] = b2 & 0x02 ? 1 : 0;
  buttons[14] = b2 & 0x04 ? 1 : 0;
  buttons[15] = b2 & 0x08 ? 1 : 0;
  const stick = (v) => Math.max(-1, v / 32767);
  return {
    buttons,
    axes: [
      stick(report.readInt16LE(10)),
      stick(report.readInt16LE(12)),
      whammy,
      tiltRaw / 255,
    ],
    tilted,
  };
}
module.exports = { decode, BUTTONS };
