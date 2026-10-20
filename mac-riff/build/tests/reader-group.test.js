const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {startGroup} = require('../reader-group');
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check) {
    const end = Date.now() + 5000;
    while (Date.now() < end) { if (check()) return; await delay(20); }
    assert.fail('Recovery condition timed out');
}
function read(file) { try { return JSON.parse(fs.readFileSync(file)); } catch { return {}; } }
function fixture(t, count = 2) {
    const dir = fs.mkdtempSync('/tmp/mrf-supervisor-');
    const script = path.join(dir, 'fake-reader.js');
    fs.writeFileSync(script, `
const fs = require('fs'), path = require('path');
const dir = path.dirname(process.argv[process.argv.indexOf('--socket') + 1]);
fs.appendFileSync(path.join(dir, 'starts'), process.pid + '\\n');
function tick() {
 const mode = fs.readFileSync(path.join(dir, 'mode'), 'utf8');
 if (mode === 'crash') process.exit(1);
 if (mode === 'stall') return;
 const file = path.join(dir, 'status.json');
 fs.writeFileSync(file + '.tmp', JSON.stringify({transportConnected:true, connected:true, updated:Date.now()/1000}));
 fs.renameSync(file + '.tmp', file);
}
tick(); setInterval(tick, 20);
`);
    const entries = Array.from({length: count}, (_, i) => {
        const sub = path.join(dir, `p${i+1}`); fs.mkdirSync(sub); fs.writeFileSync(path.join(sub, 'mode'), 'healthy');
        return {player: i+1, deviceKey: `usb:1:${i+1}`, socket: path.join(sub, 'controller.sock')};
    });
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({pid:process.pid, phase:'ready'}));
    const lease = () => fs.writeFileSync(path.join(dir, 'lease.json'), JSON.stringify({pid:process.pid, updated:Date.now()}));
    lease(); const timer = setInterval(lease, 100);
    const options = {readerPath:script, intervalMs:20, baseDelay:30, maxDelay:100, stallMs:350, killMs:50, leaseMs:1000, leaseGraceMs:80};
    const group = startGroup(entries, dir, options);
    t.after(async () => { clearInterval(timer); group.stop(); await group.done; fs.rmSync(dir, {recursive:true, force:true}); });
    const starts = n => { try { return fs.readFileSync(path.join(dir, `p${n}/starts`), 'utf8').trim().split('\n').length; } catch { return 0; } };
    const mode = (n, value) => fs.writeFileSync(path.join(dir, `p${n}/mode`), value);
    return {dir, group, entries, options, starts, mode, timer};
}
test('reader crash recovers one slot; manual retry never overlaps supervisors; shutdown cancels retries', async t => {
    const f = fixture(t);
    await until(() => f.starts(1) === 1 && f.starts(2) === 1);
    assert.throws(() => startGroup(f.entries, f.dir, f.options), /EEXIST/);
    f.mode(1, 'crash');
    await until(() => f.starts(1) >= 3);
    assert.equal(f.starts(2), 1, 'Other player must not restart');
    f.mode(1, 'healthy');
    await until(() => read(path.join(f.dir,'p1/reader-status.json')).phase === 'connected');
    const before = f.starts(1);
    fs.writeFileSync(path.join(f.dir,'p1/retry-request'), '');
    await until(() => f.starts(1) > before && read(path.join(f.dir,'p1/reader-status.json')).phase === 'connected');
    assert.equal(f.starts(2), 1);
    f.mode(1, 'crash');
    fs.writeFileSync(path.join(f.dir, 'session.json'), JSON.stringify({pid:process.pid, phase:'stopped'}));
    await f.group.done;
    const stopped = f.starts(1); await delay(200); assert.equal(f.starts(1), stopped);
    assert.equal(fs.existsSync(path.join(f.dir, 'reader-group.lock')), false);
});
test('stalled reader restarts; expired owner lease stops all readers', async t => {
    const f = fixture(t, 1);
    await until(() => read(path.join(f.dir,'p1/reader-status.json')).phase === 'connected');
    f.mode(1, 'stall');
    await until(() => f.starts(1) >= 2);
    f.mode(1, 'healthy');
    await until(() => read(path.join(f.dir,'p1/reader-status.json')).phase === 'connected');
    clearInterval(f.timer);
    fs.writeFileSync(path.join(f.dir, 'lease.json'), JSON.stringify({pid:process.pid, updated:0}));
    await f.group.done;
    assert.equal(read(path.join(f.dir,'p1/reader-status.json')).phase, 'stopped');
});
