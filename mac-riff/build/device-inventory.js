// Read-only receiver discovery; never opens or claims a USB interface.
const usb = require('usb');
const { receiverKey } = require('./receiver-selector');
console.log(JSON.stringify(usb.getDeviceList()
    .filter(d => d.deviceDescriptor.idVendor === 0x0e6f && d.deviceDescriptor.idProduct === 0x0248)
    .map(d => ({ id: receiverKey(d), name: 'PDP Riffmaster (Xbox)', vendor: 0x0e6f,
        product: 0x0248, native: false, midi: false }))));
