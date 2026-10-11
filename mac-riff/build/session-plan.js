function validatePlan(plan) {
    if (!plan || !['clonehero', 'yarg', 'backstage'].includes(plan.game) || !Array.isArray(plan.players) || !plan.players.length || plan.players.length > 4) throw new Error('Choose between one and four players.');
    const players = new Set(), devices = new Set();
    for (const p of plan.players) {
        if (!Number.isInteger(p.player) || p.player < 1 || p.player > 4 || players.has(p.player)) throw new Error('Player slots must be unique (1–4).');
        if (typeof p.deviceKey !== 'string' || !p.deviceKey || devices.has(p.deviceKey)) throw new Error('Assign each physical device to only one player.');
        if (!['native', 'midi', 'bridge'].includes(p.route)) throw new Error('Unsupported controller route.');
        if (!['guitar', 'drums', 'gamepad'].includes(p.instrument)) throw new Error('Choose an instrument profile.');
        if (p.route === 'bridge' && (p.profile !== 'pdp-riffmaster-xbox' || !/^usb:\d+:(\d+(\.\d+)*|address-\d+)$/.test(p.deviceKey) || p.instrument !== 'guitar')) throw new Error('Only Xbox Riffmaster guitars use this bridge.');
        if (p.route === 'bridge' && plan.game !== 'clonehero') throw new Error('Riffmaster bridging is currently available only in Clone Hero.');
        if (p.route === 'midi' && p.instrument !== 'drums') throw new Error('Select Drums for a MIDI input.');
        players.add(p.player); devices.add(p.deviceKey);
    }
    return plan;
}
function bridgePlayers(plan) { return validatePlan(plan).players.filter(p => p.route === 'bridge'); }
function controllerName(player) { return player === 1 ? 'MacRiff Riffmaster' : `MacRiff Riffmaster P${player}`; }
module.exports = { validatePlan, bridgePlayers, controllerName };
