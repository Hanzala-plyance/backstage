// Unprivileged session owner. Each emulated controller has its own receiver,
// socket and state. Native devices are left entirely to the selected game.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { validatePlan, bridgePlayers, controllerName } = require('./session-plan');
const root = __dirname;
process.chdir(root);
const mode = process.argv[2];
const plan = validatePlan(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')));
const bridges = bridgePlayers(plan);
if (!['test', 'game'].includes(mode) || !bridges.length) throw new Error('No bridge controllers selected. Native sessions launch directly.');
const session = fs.mkdtempSync('/tmp/macriff-band.');
fs.chmodSync(session, 0o700);
const metadata = { mode, pid: process.pid, phase: 'starting', players: plan.players };
function state(phase, message) {
    Object.assign(metadata, {phase, message});
    const tmp = path.join(session, 'session.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(metadata));
    fs.renameSync(tmp, path.join(session, 'session.json'));
}
fs.writeFileSync(path.join(root, 'build/latest-band-session.txt'), session);
const config = bridges.map(p => {
    const dir = path.join(session, `p${p.player}`); fs.mkdirSync(dir, {mode: 0o700});
    return {player: p.player, name: controllerName(p.player), socket: path.join(dir, 'controller.sock'), deviceKey: p.deviceKey};
});
const configPath = path.join(session, 'controllers.json');
fs.writeFileSync(configPath, JSON.stringify(config));
let host, authorization, stopping = false;
function lease() {
    if (stopping) return;
    const file = path.join(session, 'lease.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify({pid: process.pid, updated: Date.now()}));
    fs.renameSync(file + '.tmp', file);
}
lease();
setInterval(lease, 1000).unref();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function shutdown(code = 0, message = 'Session ended') {
    if (stopping) return; stopping = true;
    state(code ? 'error' : 'stopped', message);
    authorization?.kill('SIGTERM');
    host?.kill('SIGTERM');
    // Allow the root readers time to notice socket closure and release USB.
    for (let i = 0; i < 50; i++) {
        const released = !fs.existsSync(path.join(session, 'reader-group.lock'));
        if (released) break;
        await delay(100);
    }
    process.exit(code);
}
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function json(p) { try { return JSON.parse(read(p)); } catch { return {}; } }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => shutdown());
const parent = process.ppid;
if (mode === 'test') setInterval(() => { if (process.ppid !== parent) shutdown(); }, 1000).unref();
async function main() {
    state('starting', mode === 'test' ? 'Starting controller tests…' : 'Preparing Clone Hero…');
    if (mode === 'game') {
        if (spawnSync('/bin/bash', ['prepare-bundled-game.sh'], {stdio: 'inherit'}).status !== 0) throw new Error('Could not prepare Clone Hero.');
        for (const p of bridges) {
            if (spawnSync(path.join(root, 'build/configure-clone-hero'), ['--player', String(p.player), '--preserve-existing'], {stdio: 'inherit'}).status !== 0) throw new Error(`Could not prepare Player ${p.player} bindings. Close existing games and retry.`);
        }
    }
    const log = fs.openSync(path.join(session, mode === 'game' ? 'launch.log' : 'test.log'), 'a');
    const executable = mode === 'test' ? path.join(root, 'build/controller-test-host') : path.join(root, 'build/Clone Hero (MacRiff).app/Contents/MacOS/Clone Hero');
    host = spawn(executable, mode === 'test' ? [] : ['-logFile', path.join(session, 'game.log')], {
        env: {...process.env, MACRIFF_CONTROLLER_CONFIG: configPath, DYLD_INSERT_LIBRARIES: path.join(root, 'build/libMacRiffController.dylib')},
        stdio: ['ignore', log, log]
    }); fs.closeSync(log);
    host.on('error', e => shutdown(1, e.message));
    host.on('exit', code => shutdown(code || 0));
    for (let i = 0; i < 100 && !config.every(c => fs.existsSync(c.socket)); i++) await delay(100);
    if (!config.every(c => fs.existsSync(c.socket))) throw new Error('The controller adapter did not start.');
    if (stopping) return;
    lease();
    state('authorizing', 'Approve USB access for the selected Riffmaster receivers.');
    const authLog = fs.openSync(path.join(session, 'authorization.log'), 'a');
    authorization = spawn('/bin/bash', [path.join(root, 'authorize-readers.sh'), path.join(root, 'node_modules'), process.execPath,
        path.join(root, 'reader-group.js'), configPath, path.join(session, 'readers.log')], {stdio: ['ignore', authLog, authLog]});
    fs.closeSync(authLog);
    const code = await new Promise((resolve, reject) => { authorization.on('exit', resolve); authorization.on('error', reject); });
    authorization = null;
    if (stopping) return;
    if (code !== 0) throw new Error('USB access was cancelled or unavailable. Connect again to retry.');
    state('ready', mode === 'test' ? 'Test each bridged guitar. Native controllers keep their game mappings.' : 'Assign the listed controllers to their players in Clone Hero.');
    // Health is separate from registration: a registered controller can lose USB.
    setInterval(() => {
        if (stopping) return;
        const lost = config.filter(c => {
            const status = json(path.join(path.dirname(c.socket), 'status.json'));
            return !status.connected || Date.now() / 1000 - status.updated > 4;
        });
        const detected = config.every(c => json(path.join(path.dirname(c.socket), 'status.json')).gameDetected);
        const phase = lost.length ? 'recovering' : mode === 'game' && detected ? 'playing' : 'ready';
        const message = lost.length ? `Player ${lost.map(c => c.player).join(', ')}: waiting for input or reconnecting automatically. Keep the receiver in the same USB port.` :
            mode === 'test' ? 'Connected. Test every fret and both strum directions before playing.' :
            detected ? 'All bridged controllers connected. Automatic recovery is active.' : 'Connected. Assign the controllers in Clone Hero.';
        if (phase !== metadata.phase || message !== metadata.message) state(phase, message);
    }, 1000);
}
main().catch(e => shutdown(1, e.message));
