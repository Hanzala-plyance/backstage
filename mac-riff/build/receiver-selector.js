function receiverKey(device) {
    // Bus and physical USB port path disambiguate identical receivers and survive
    // normal re-enumeration on the same port. Fall back to address when unavailable.
    const port = device.portNumbers?.length ? device.portNumbers.join('.') : `address-${device.deviceAddress}`;
    return `usb:${device.busNumber}:${port}`;
}
function selectReceiver(devices, key) {
    const matches = devices.filter(d => d.deviceDescriptor.idVendor === 0x0e6f && d.deviceDescriptor.idProduct === 0x0248);
    if (key) {
        const selected = matches.filter(d => receiverKey(d) === key);
        if (selected.length !== 1) throw new Error('Selected receiver is missing or ambiguous. Refresh and choose its USB port again.');
        return selected[0];
    }
    if (matches.length !== 1) throw new Error(matches.length ? 'Multiple Riffmasters found. Select a receiver for each player in MacRiff Setup.' : 'Riffmaster receiver not found.');
    return matches[0];
}
module.exports = { receiverKey, selectReceiver };
