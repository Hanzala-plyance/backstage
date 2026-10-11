// Riffmaster receiver discovery and selection. Adapted from MacRiff
// (mac-riff/build/receiver-selector.js, MIT, cdapayne). Discovery only lists
// devices; it never opens or claims a USB interface.
const VID = 0x0e6f,
  PID = 0x0248; // PDP Riffmaster for Xbox receiver
/** Bus and physical port path tell identical receivers apart and survive
 * re-enumeration on the same port. */
function receiverKey(device) {
  const port = device.portNumbers?.length
    ? device.portNumbers.join(".")
    : `address-${device.deviceAddress}`;
  return `usb:${device.busNumber}:${port}`;
}
const isReceiver = (d) =>
  d.deviceDescriptor.idVendor === VID && d.deviceDescriptor.idProduct === PID;
function selectReceiver(devices, key) {
  const matches = devices.filter(
    (d) => isReceiver(d) && receiverKey(d) === key,
  );
  if (matches.length !== 1)
    throw new Error(
      "Riffmaster receiver is missing. Keep it in the same USB port.",
    );
  return matches[0];
}
const KEY = /^usb:\d+:(\d+(\.\d+)*|address-\d+)$/;
module.exports = { VID, PID, KEY, receiverKey, isReceiver, selectReceiver };
