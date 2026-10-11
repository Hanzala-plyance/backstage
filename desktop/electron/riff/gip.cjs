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
  constructor(device, { onReport, onClose, onEvent, onGuitar }) {
    this.device = device;
    this.onReport = onReport;
    this.onClose = onClose;
    this.onEvent = onEvent;
    this.onGuitar = onGuitar;
    this.closed = false;
    this.sequence = 0;
    // What the receiver has sent, for diagnostics and guitar presence: a
    // receiver with no guitar paired and on sends nothing.
    this.stats = { packets: {}, lastPacket: 0, announced: false, input: false };
  }
  event(text) {
    this.onEvent?.(text);
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
      // Reconfiguring a receiver resets it, which would also cut off another
      // program reading it; skip it when configuration 1 is already active.
      let configured = false;
      try {
        configured = this.device.configDescriptor?.bConfigurationValue === 1;
      } catch {}
      const configure = (done) =>
        configured ? done() : this.device.setConfiguration(1, done);
      configure((error) => {
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
        this.event("Receiver opened");
        this.handshake();
        resolve();
      });
    });
  }
  packet(data) {
    if (data.length < 4) return;
    const cmd = "0x" + data[0].toString(16).padStart(2, "0");
    const stats = this.stats;
    stats.packets[cmd] = (stats.packets[cmd] ?? 0) + 1;
    stats.lastPacket = Date.now();
    if (data[0] === 0x02) {
      // The guitar (re)announced itself: it is on and paired.
      this.event("Guitar announced itself");
      if (!stats.announced) {
        stats.announced = true;
        this.onGuitar?.();
      }
      return this.handshake();
    }
    if (data[0] !== 0x20) return;
    if (!stats.input) {
      stats.input = true;
      this.event("First guitar input");
      this.onGuitar?.();
    }
    const report = encodeReport(data);
    if (report) this.onReport(report);
  }
  handshake() {
    if (!this.out || this.closed || this.shaking) return;
    this.shaking = true;
    this.event("Sent Xbox start-up");
    let i = 0;
    const next = () => {
      if (this.closed || i >= STARTUP.length)
        return void (this.shaking = false);
      this.sequence = (this.sequence + 1) & 0xff || 1;
      this.out.transfer(Buffer.from(STARTUP[i++](this.sequence)), (error) => {
        if (error) {
          this.shaking = false;
          this.event(`Start-up failed: ${error.message ?? error}`);
          return this.close(error);
        }
        setTimeout(next, 20);
      });
    };
    next();
  }
  /** Stops polling and releases the receiver for other apps; `then` runs
   * once USB has let go. */
  close(error, then) {
    if (this.closed) return void then?.();
    this.closed = true;
    this.event(error ? `Closed: ${error.message ?? error}` : "Released");
    const done = () => {
      try {
        this.device.close();
      } catch {}
      this.onClose?.(error);
      then?.();
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
