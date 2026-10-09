const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePlan, bridgePlayers } = require('../session-plan');
const { selectReceiver, receiverKey } = require('../receiver-selector');
const player = (id, route, instrument = 'guitar') => ({player:id, deviceKey:route === 'bridge' ? `usb:1:${id}` : `${route}:${id}`, route, instrument, profile:route === 'bridge' ? 'pdp-riffmaster-xbox' : 'native'});
test('mixed band bridges only the Riffmaster, preserving native gamepads and MIDI drums', () => {
    const plan = {game:'clonehero', players:[player(1,'bridge'), player(2,'native','gamepad'), player(3,'native','gamepad'), player(4,'midi','drums')]};
    assert.deepEqual(bridgePlayers(plan).map(p=>p.player), [1]);
});
test('native-only YARG session needs no emulation and retains all four roles', () => {
    const plan = {game:'yarg', players:[player(1,'native'), player(2,'native','gamepad'), player(3,'midi','drums'), player(4,'native')]};
    assert.equal(validatePlan(plan).players.length,4);
    assert.deepEqual(bridgePlayers(plan),[]);
});
test('invalid combinations cannot silently become bridged instruments', () => {
    assert.throws(()=>validatePlan({game:'yarg',players:[player(1,'bridge')]}));
    assert.throws(()=>validatePlan({game:'clonehero',players:[player(1,'bridge','drums')]}));
    assert.throws(()=>validatePlan({game:'clonehero',players:[player(1,'native'),player(1,'native')]}));
    const duplicate=player(2,'native'); duplicate.deviceKey='native:1';
    assert.throws(()=>validatePlan({game:'clonehero',players:[player(1,'native'),duplicate]}));
});
test('identical receivers are selected by USB port, never first-match guessing', () => {
    const a={busNumber:1,portNumbers:[2],deviceAddress:3,deviceDescriptor:{idVendor:3695,idProduct:584}};
    const b={...a,portNumbers:[4],deviceAddress:5};
    assert.throws(()=>selectReceiver([a,b],null));
    assert.equal(selectReceiver([a,b],receiverKey(b)),b);
    assert.equal(receiverKey({...b,deviceAddress:55}),receiverKey(b));
    assert.throws(()=>selectReceiver([a],'usb:1:4'));
});
