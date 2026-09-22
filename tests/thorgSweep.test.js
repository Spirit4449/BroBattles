const test = require('node:test');
const assert = require('node:assert/strict');
const { THORG_SWEEP, THORG_ATTACK_FRAMES, thorgAttackFrameAt, sampleThorgSweep, sampleThorgHitbox } = require('../src/shared/thorgSweep');
const { createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
const { makeRoom } = require('./helpers/botRoom');
const rage = require('../src/server/core/gameRoom/abilities/thorgRageAbility');

test('damage reach is 1.3x the visual tip and thickness doubles in both facings and rage', () => {
  for (const direction of [-1, 1]) for (const scale of [1, 1.25]) {
    const body = { x: 300, y: 200, direction, scale };
    for (const progress of [0, .25, .5, .75, 1]) {
      const art = sampleThorgSweep(body, progress);
      const hit = sampleThorgHitbox(body, progress);
      assert.deepEqual(hit.a, art.grip);
      assert.ok(Math.abs(hit.b.x - body.x - (art.tip.x - body.x) * 1.3) < 1e-8);
      assert.equal(hit.b.y, art.tip.y);
      assert.equal(hit.radius, art.radius * 2);
    }
  }
});

test('replacement swing crosses both sides and passes overhead, mirroring its grip and tip', () => {
  const body = { x: 300, y: 200, direction: 1 };
  assert.ok(sampleThorgSweep(body, 0).x < body.x);
  assert.ok(sampleThorgSweep(body, 0.6).x > body.x);
  assert.ok(sampleThorgSweep(body, 0.8).y < body.y - 30);
  assert.ok(sampleThorgSweep(body, 1).x < body.x);
  for (let i = 0; i <= 100; i++) {
    const a = sampleThorgSweep(body, i / 100), b = sampleThorgSweep({ ...body, direction: -1 }, i / 100);
    assert.ok(Math.abs(a.x + b.x - body.x * 2) < 1e-9);
    assert.equal(a.y, b.y);
    assert.ok(Math.abs(a.grip.x + b.grip.x - body.x * 2) < 1e-9);
    assert.equal(a.grip.y, b.grip.y);
  }
});

test('damage capsule follows the displayed grip and mace tip', t => {
  const { damageHitboxSnapshot } = require('../src/server/core/gameRoom/damageHitboxes');
  const { room, players: [p, target] } = makeRoom({ characters: ['thorg', 'ninja'] });
  t.after(() => room.cleanup());
  room.matchData.editorDebugHitboxes = true;
  target.loaded = false;
  Object.assign(p, { x: 500, y: 300 });
  const now = Date.now();
  const attack = createRuntimeAttack(p, { type: 'thorg-fall', id: 'capsule', direction: 1 }, now);
  tickRuntimeAttack(room, attack, now + THORG_SWEEP.windupMs);
  const shape = damageHitboxSnapshot(room, now + THORG_SWEEP.windupMs)[0];
  assert.equal(shape.kind, 'sweep');
  const pose = sampleThorgSweep({ x: 500, y: 300 }, 0);
  assert.deepEqual(shape.a, pose.grip);
  assert.deepEqual(shape.b, { x: 500 + (pose.tip.x - 500) * 1.3, y: pose.tip.y });
  assert.equal(shape.radius, 14);
});

test('legacy skins retain the complete circular swing', () => {
  const body = { x: 300, y: 200, legacy: true };
  assert.deepEqual(sampleThorgSweep(body, 0), sampleThorgSweep(body, 1));
  assert.equal(sampleThorgSweep(body, .5).x, 300 - THORG_SWEEP.radiusX);
});

test('authoritative legacy skin hitboxes still use their rendered orbit', t => {
  const { damageHitboxSnapshot } = require('../src/server/core/gameRoom/damageHitboxes');
  const { room, players: [p, target] } = makeRoom({ characters: ['thorg', 'ninja'] });
  t.after(() => room.cleanup());
  room.matchData.editorDebugHitboxes = true;
  target.loaded = false;
  Object.assign(p, { x: 500, y: 300, selected_skin_id: 'thorg-storm' });
  const now = Date.now();
  const attack = createRuntimeAttack(p, { type: 'thorg-fall', id: 'legacy', direction: -1 }, now);
  tickRuntimeAttack(room, attack, now + THORG_SWEEP.windupMs);
  const shape = damageHitboxSnapshot(room, now + THORG_SWEEP.windupMs)[0];
  assert.deepEqual(shape.a, { x: 500, y: 313 });
  assert.deepEqual(shape.b, { x: 500 - (THORG_SWEEP.radiusX + THORG_SWEEP.tipOffset) * 1.3, y: 313 });
  assert.equal(shape.radius, THORG_SWEEP.hitboxRadius * 2);
});

test('every active displayed frame and combat pose share one clock', () => {
  let elapsed = 0;
  for (const frame of THORG_ATTACK_FRAMES) {
    const middle = elapsed + frame.durationMs / 2;
    assert.equal(thorgAttackFrameAt(middle).frame, frame.frame);
    if (middle >= 70 && middle < 570) {
      const sample = sampleThorgSweep({}, (middle - 70) / 500);
      assert.deepEqual(sample.grip, { x: frame.grip[0], y: frame.grip[1] });
      assert.deepEqual(sample.tip, { x: frame.tip[0], y: frame.tip[1] });
    }
    elapsed += frame.durationMs;
  }
  assert.ok(Math.abs(elapsed - 870) < 1e-8);
});

test('authoritative sweep hits front and rear once, survives a delayed tick, and ignores spoofed reach/timing', t => {
  const { room, players: [p, front, rear, far] } = makeRoom({ characters: ['thorg', 'ninja', 'ninja', 'ninja'] });
  t.after(() => room.cleanup());
  Object.assign(p, { x: 500, y: 300, flip: false });
  for (const [target, x] of [[front, 575], [rear, 440], [far, 900]]) {
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
    x: p.x + 128,
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
  assert.equal(head.x, 500 + thorgAttackFrameAt(THORG_SWEEP.windupMs).tip[0] * scale);
  const visualCenterY = 300 - THORG_SWEEP.footOffset * (scale - 1);
  assert.equal(visualCenterY + THORG_SWEEP.footOffset * scale, 300 + THORG_SWEEP.footOffset);
});
