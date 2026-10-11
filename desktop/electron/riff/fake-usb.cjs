// Test stand-in for the usb module: two Riffmaster receivers that stream GIP
// input. Receiver 1 cycles orange, receiver 2 d-pad right: buttons no menu
// acts on, so a test can leave them connected.
const { EventEmitter } = require("events");
function receiver(port, frets, dpad = 0) {
  const input = new EventEmitter();
  Object.assign(input, {
    direction: "in",
    transferType: 3,
    descriptor: { wMaxPacketSize: 64 },
  });
  let timer;
  input.startPoll = () => {
    let on = false;
    timer = setInterval(() => {
      const gip = Buffer.alloc(18);
      gip[0] = 0x20;
      gip[3] = 14;
      on = !on;
      gip[5] = on ? dpad : 0;
      gip[9] = on ? frets : 0;
      input.emit("data", gip);
    }, 400);
  };
  input.stopPoll = (done) => {
    clearInterval(timer);
    done?.();
  };
  const device = {
    busNumber: 9,
    portNumbers: [port],
    deviceAddress: port,
    deviceDescriptor: { idVendor: 0x0e6f, idProduct: 0x0248 },
    sent: [],
    opened: false,
    open() {
      device.opened = true;
    },
    close() {
      device.opened = false;
    },
    setConfiguration: (_, done) => setImmediate(done),
    interface: () => ({
      endpoints: [
        input,
        {
          direction: "out",
          transferType: 3,
          transfer: (data, done) => {
            device.sent.push([...data]);
            setImmediate(done);
          },
        },
      ],
      isKernelDriverActive: () => false,
      claim() {},
      release: (_, done) => done(),
    }),
  };
  return device;
}
module.exports = function fakeUsb() {
  const devices = [receiver(1, 0x10), receiver(2, 0, 0x08)];
  const usb = new EventEmitter();
  return {
    getDeviceList: () => devices.filter((d) => !d.unplugged),
    usb,
    devices,
  };
};
