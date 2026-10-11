// Drives one Riffmaster receiver inside Backstage: configures it, claims its
// interface, sends the Xbox GIP start-up sequence and turns input packets into
// MRF2 reports. Protocol handling adapted from MacRiff (mac-riff/build/
// bridge.js, MIT, cdapayne). `device` is a node-usb Device (or a test double).
const { encodeReport } = require("./output.cjs");
const INTERRUPT = 3; // LIBUSB_TRANSFER_TYPE_INTERRUPT
const STARTUP = [
  (n) => [0x04, 0x20, n, 0x00], // identify
  (n) => [0x05, 0x20, n, 0x01, 0x00], // power on
  (n) => [0x0a, 0x20, n, 0x03, 0x00, 0x01, 0x14], // LED
  (n) => [0x06, 0x20, n, 0x02, 0x01, 0x00], // security passed
  (n) => [
    0x09,
    0x00,
    n,
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
  ], // rumble init
];
class Receiver {
  constructor(device, { onReport, onClose }) {
    this.device = device;
    this.onReport = onReport;
    this.onClose = onClose;
    this.closed = false;
    this.sequence = 0;
  }
  /** Resolves once input is streaming; rejects with a readable reason. */
  open() {
    return new Promise((resolve, reject) => {
      const fail = (stage, error) => {
        this.close();
        // Another process holding the interface shows up as ACCESS, BUSY, or
        // (when claiming on macOS) NOT_FOUND.
        const text = String(error?.message ?? error);
        const denied =
          /ACCESS|BUSY/.test(text) ||
          (stage.startsWith("Could not claim") && /NOT_FOUND/.test(text));
        reject(
          Object.assign(new Error(`${stage}: ${error?.message ?? error}`), {
            denied,
          }),
        );
      };
      try {
        this.device.open();
      } catch (error) {
        return fail("Could not open the receiver", error);
      }
      this.device.setConfiguration(1, (error) => {
        if (error) return fail("Could not configure the receiver", error);
        try {
          this.iface = this.device.interface(0);
          if (this.iface.isKernelDriverActive?.())
            this.iface.detachKernelDriver();
          this.iface.claim();
        } catch (claimError) {
          return fail("Could not claim the receiver", claimError);
        }
        const endpoints = this.iface.endpoints;
        this.in = endpoints.find(
          (e) => e.direction === "in" && e.transferType === INTERRUPT,
        );
        this.out = endpoints.find(
          (e) => e.direction === "out" && e.transferType === INTERRUPT,
        );
        if (!this.in) return fail("Receiver input", "endpoint not found");
        this.in.on("data", (data) => this.packet(data));
        this.in.on("error", (e) => {
          if (!this.closed) this.close(e);
        });
        this.in.startPoll(1, this.in.descriptor.wMaxPacketSize);
        this.handshake();
        resolve();
      });
    });
  }
  packet(data) {
    if (data.length < 4) return;
    if (data[0] === 0x02) return this.handshake(); // guitar (re)announced
    if (data[0] !== 0x20) return;
    const report = encodeReport(data);
    if (report) this.onReport(report);
  }
  handshake() {
    if (!this.out || this.closed || this.shaking) return;
    this.shaking = true;
    let i = 0;
    const next = () => {
      if (this.closed || i >= STARTUP.length)
        return void (this.shaking = false);
      this.sequence = (this.sequence + 1) & 0xff || 1;
      this.out.transfer(Buffer.from(STARTUP[i++](this.sequence)), (error) => {
        if (error) {
          this.shaking = false;
          return this.close(error);
        }
        setTimeout(next, 20);
      });
    };
    next();
  }
  /** Stops polling and releases the receiver for other apps. */
  close(error) {
    if (this.closed) return;
    this.closed = true;
    const done = () => {
      try {
        this.device.close();
      } catch {}
      this.onClose?.(error);
    };
    const release = () => {
      if (!this.iface) return done();
      try {
        this.iface.release(true, done);
      } catch {
        done();
      }
    };
    try {
      if (this.in) this.in.stopPoll(release);
      else release();
    } catch {
      release();
    }
  }
}
module.exports = { Receiver, STARTUP };
