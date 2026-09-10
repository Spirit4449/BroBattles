const test = require('node:test');
const assert = require('node:assert/strict');
const { THORG_SWEEP, sampleThorgSweep } = require('../src/shared/thorgSweep');
const { createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
const { makeRoom } = require('./helpers/botRoom');
const rage = require('../src/server/core/gameRoom/abilities/thorgRageAbility');

test('sweep is continuous, body-relative, mirrored and visits both sides', () => {
  const body = { x: 300, y: 200, direction: 1 };
  assert.deepEqual(sampleThorgSweep(body, 0), sampleThorgSweep(body, 1));
  assert.equal(sampleThorgSweep(body, 0.5).x, body.x - THORG_SWEEP.radiusX);
  for (let i = 0; i <= 100; i++) {
    const a = sampleThorgSweep(body, i / 100), b = sampleThorgSweep({ ...body, direction: -1 }, i / 100);
    assert.ok(Math.abs(a.x + b.x - body.x * 2) < 1e-9);
    assert.equal(a.y, b.y);
  }
});

test('authoritative sweep hits front and rear once, survives a delayed tick, and ignores spoofed reach/timing', t => {
  const { room, players: [p, front, rear, far] } = makeRoom({ characters: ['thorg', 'ninja', 'ninja', 'ninja'] });
  t.after(() => room.cleanup());
  Object.assign(p, { x: 500, y: 300, flip: false });
  for (const [target, x] of [[front, 575], [rear, 425], [far, 900]]) {
    Object.assign(target, { team: 'team2', x, y: 313, connected: true, _bodyHalfWidth: 5, _bodyHalfHeight: 5, _bodyCenterOffsetX: 0, _bodyCenterOffsetY: 0 });
  }
  const before = [front.health, rear.health, far.health];
  const now = Date.now();
  const attack = createRuntimeAttack(p, { type: 'thorg-fall', id: 'sweep-test', direction: 1, range: 99999, strikeMs: 1 }, now);
  tickRuntimeAttack(room, attack, now + THORG_SWEEP.windupMs - 1);
  assert.deepEqual([front.health, rear.health, far.health], before);
  assert.equal(tickRuntimeAttack(room, attack, now + THORG_SWEEP.windupMs + THORG_SWEEP.strikeMs), true);
  assert.ok(front.health < before[0]);
  assert.ok(rear.health < before[1]);
  assert.equal(far.health, before[2]);
  const after = [front.health, rear.health];
  tickRuntimeAttack(room, attack, now + 800);
  assert.deepEqual([front.health, rear.health], after);
});

test('every normal hit pushes away from Thorg on either side', () => {
  const p = { x: 100 };
  assert.deepEqual(rage.getKnockback(p, { x: 150 }, 0), { amountX: 140, amountY: 60 });
  assert.deepEqual(rage.getKnockback(p, { x: 50 }, 0), { amountX: -140, amountY: 60 });
  assert.equal(rage.requiresMeleeFacingCheck('basic', false), false);
});

test('rage grows sweep around fixed feet and expands authoritative hit reach', t => {
  const effects = require('../src/server/core/gameRoom/effects/effectManager');
  const { room, players: [p, target] } = makeRoom({ characters: ['thorg', 'ninja'] });
  t.after(() => room.cleanup());
  Object.assign(p, { x: 500, y: 300 });
  Object.assign(target, {
    x: p.x + THORG_SWEEP.radiusX + THORG_SWEEP.headWidth / 2 + 10,
    y: 300,
    connected: true,
    _bodyHalfWidth: 2,
    _bodyHalfHeight: 2,
    _bodyCenterOffsetX: 0,
    _bodyCenterOffsetY: 0,
  });
  const now = Date.now(), before = target.health;
  const normal = createRuntimeAttack(p, { type: 'thorg-fall', id: 'normal' }, now);
  tickRuntimeAttack(room, normal, now + 600);
  assert.equal(target.health, before);
  effects.apply(p, 'thorgRage', now);
  const raging = createRuntimeAttack(p, { type: 'thorg-fall', id: 'raging' }, now);
  tickRuntimeAttack(room, raging, now + 600);
  assert.ok(target.health < before);
  const scale = THORG_SWEEP.rageScale;
  const head = sampleThorgSweep({x:500,y:300,scale},0);
  assert.equal(head.x, 500 + THORG_SWEEP.radiusX * scale);
  const visualCenterY = 300 - THORG_SWEEP.footOffset * (scale - 1);
  assert.equal(visualCenterY + THORG_SWEEP.footOffset * scale, 300 + THORG_SWEEP.footOffset);
});
