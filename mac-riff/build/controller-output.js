// Sends complete guitar reports to the controller adapter inside Clone Hero.
// The socket is private to one launcher session; no network port is opened.
const net = require('net');

function createControllerOutput(socketPath, onDisconnect) {
    if (!socketPath) throw new Error('Controller mode requires --socket PATH');
    const socket = net.createConnection(socketPath);
    let connected = false;
    let stopped = false;
    const pending = [];
    let writable = true;
    // Heartbeats detect a stalled reader without treating an idle guitar as lost.
    const heartbeat = Buffer.alloc(16); heartbeat.write('MRFH');
    const pulse = setInterval(() => {
        if (connected && writable && !pending.length) writable = socket.write(heartbeat);
    }, 500);
    socket.on('connect', () => {
        connected = true;
        console.log('[Controller] Connected to Clone Hero. Keyboard injection is disabled.');
        flush();
    });
    socket.on('drain', () => { writable = true; flush(); });
    socket.on('error', error => console.error(`[Controller] ${error.message}`));
    socket.on('close', () => {
        clearInterval(pulse);
        if (!stopped) onDisconnect(connected ? 0 : 1);
    });
    function flush() {
        while (connected && writable && pending.length) {
            writable = socket.write(pending.shift());
        }
    }
    return {
        send(data, noSpecial = false) {
            const report = encodeReport(data, noSpecial);
            if (!report) return false;
            // Never coalesce press/release edges: fast strums must survive backpressure.
            if (pending.length >= 4096) {
                socket.destroy(new Error('Controller output stalled; reconnecting.'));
                return false;
            }
            pending.push(report);
            flush();
            return true;
        },
        close() { stopped = true; clearInterval(pulse); socket.destroy(); }
    };
}

// Xbox One guitar GIP input, including Riffmaster's signed 16-bit stick.
// Dedicated fret masks avoid the generic button flags shared with the joystick.
function encodeReport(data, noSpecial = false) {
    if (!Buffer.isBuffer(data) || data.length < 18 || data[0] !== 0x20 ||
        (data[1] & 0xc0) || data[3] < 14 || data.length < 4 + data[3]) return null;
    const report = Buffer.alloc(16);
    report.write('MRF2');
    report[4] = data[4] & 0x0c;
    report[5] = data[5] & 0x0f;
    report[6] = noSpecial ? 0 : data[7];
    report[7] = noSpecial ? 0 : data[6];
    report[8] = (data[9] | data[10]) & 0x1f;
    report[9] = (data[5] & 0x40) && !(data[10] & 0x1f) ? 1 : 0;
    data.copy(report, 10, 14, 18);
    return report;
}

module.exports = { createControllerOutput, encodeReport };
