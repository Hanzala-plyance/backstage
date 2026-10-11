const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createControllerOutput, encodeReport } = require('../controller-output');

test('controller transport preserves buttons/axes and reports game disconnection', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrf-'));
    // macOS Unix-domain socket paths are limited to 104 bytes.
    const socketPath = path.join(dir, 'c');
    const server = net.createServer();
    await new Promise(resolve => server.listen(socketPath, resolve));
    let finish;
    const disconnected = new Promise(resolve => { finish = resolve; });
    const connection = once(server, 'connection');
    const output = createControllerOutput(socketPath, finish);
    const [peer] = await connection;
    try {
        const firstReport = once(peer, 'data');
        output.send(input({ frets: 31, dpad: 1, whammy: 255, tilt: 148 }));
        assert.deepEqual((await firstReport)[0], Buffer.from([77, 82, 70, 50, 0, 1, 255, 148, 31, 0, 0, 0, 0, 0, 0, 0]));
        const disabledReport = once(peer, 'data');
        output.send(input({ frets: 2, dpad: 2, whammy: 255, tilt: 148 }), true);
        assert.deepEqual((await disabledReport)[0], Buffer.from([77, 82, 70, 50, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0]));
        const idlePulse = (await once(peer, 'data'))[0];
        assert.equal(idlePulse.subarray(0, 4).toString(), 'MRFH');
        assert.deepEqual(idlePulse.subarray(4), Buffer.alloc(12), 'Idle pulse must carry no old input');
        peer.destroy();
        assert.equal(await disconnected, 0);
    } finally {
        output.close();
        peer.destroy();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a missing game socket reports failure instead of starting keyboard injection', async () => {
    let finish;
    const disconnected = new Promise(resolve => { finish = resolve; });
    const output = createControllerOutput('/tmp/macriff-nonexistent-test-socket', finish);
    assert.equal(await disconnected, 1);
    output.close();
});

function input({frets = 0, solo = 0, dpad = 0, flags = 0, whammy = 0, tilt = 0, x = 0, y = 0} = {}) {
    const data = Buffer.alloc(32);
    data[0] = 0x20; data[3] = 28; data[4] = flags; data[5] = dpad;
    data[6] = tilt; data[7] = whammy; data[9] = frets; data[10] = solo;
    data.writeInt16LE(x, 14); data.writeInt16LE(y, 16);
    return data;
}

test('dedicated fret rows do not mistake joystick flags for frets', () => {
    assert.equal(encodeReport(input({flags: 0xf0, dpad: 0x50}))[8], 0);
    const solo = encodeReport(input({frets: 1, solo: 30, dpad: 0x40}));
    assert.equal(solo[8], 31);
    assert.equal(solo[9], 0);
    assert.equal(encodeReport(input({dpad: 0x40}))[9], 1);
});

test('preserves signed 16-bit stick resolution and rejects incomplete input', () => {
    const report = encodeReport(input({x: -32768, y: 32767}));
    assert.equal(report.readInt16LE(10), -32768);
    assert.equal(report.readInt16LE(12), 32767);
    assert.equal(encodeReport(input().subarray(0, 17)), null);
    assert.equal(encodeReport(input().subarray(0, 25)), null);
    const announce = input(); announce[0] = 2;
    assert.equal(encodeReport(announce), null);
});
