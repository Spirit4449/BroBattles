const test = require('node:test');
const assert = require('node:assert/strict');
const effects = require('../src/server/core/gameRoom/effects/effectManager');
const { buildWorldStatePayload } = require('../src/server/core/gameRoom/roomStateManager');
const { resolveLocalEffectMovement, EFFECT_RULES } = require('../src/shared/effectRules');
const { characterDefinitions } = require('../src/shared/characters');

function snapshot(player, now) {
  return buildWorldStatePayload({
    players: new Map([[player.name, player]]), _powerups: new Map(),
    _buildDeathDropsSnapshot: () => [],
    _buildPlayerEffectsSnapshot: () => ({ [player.name]: effects.snapshotAll(player, now) }),
  });
}

function assertMovementMatches(player, now) {
  const payload = snapshot(player, now);
  const local = resolveLocalEffectMovement(payload.playerEffects[player.name], payload.playerEffectMovement[player.name]);
  const { speedMult, jumpMult } = effects.getModifiers(player, now);
  assert.deepEqual(local, { speedMult, jumpMult });
  return local;
}

test('world snapshots carry scaled boosts and parameterized slows through refresh and expiry', t => {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  const player = { name: 'Player' };
  effects.apply(player, 'gravityBoots', now, { powerScale: 2 });
  effects.apply(player, 'gloopSlimeSlow', now, { speedMult: 0.2, jumpMult: 0.3, durationMs: 500 });
  let movement = assertMovementMatches(player, now);
  assert.ok(Math.abs(movement.speedMult - 0.26) < 1e-10);
  assert.equal(movement.jumpMult, 0.63);
  now += 200;
  effects.apply(player, 'gloopSlimeSlow', now, { speedMult: 0, jumpMult: 0, durationMs: 100 });
  assert.deepEqual(assertMovementMatches(player, now), { speedMult: 0, jumpMult: 0 });
  now += 100;
  assert.deepEqual(assertMovementMatches(player, now), { speedMult: 1.2999999999999998, jumpMult: 2.1 });
  now += 7000;
  assert.deepEqual(assertMovementMatches(player, now), { speedMult: 1, jumpMult: 1 });
});

test('base client fallback and server agree for every movement effect and stacked combinations', t => {
  const now = 10000;
  t.mock.method(Date, 'now', () => now);
  for (const keys of [...Object.keys(EFFECT_RULES).map(key => [key]), ['rage', 'gravityBoots', 'freeze', 'gloopHookSlow'], ['thorgRage', 'stun']]) {
    const player = { name: 'Player' };
    for (const key of keys) effects.apply(player, key, now);
    const { speedMult, jumpMult } = effects.getModifiers(player, now);
    assert.deepEqual(resolveLocalEffectMovement(effects.snapshotAll(player, now)), { speedMult, jumpMult }, keys.join(','));
  }
});

test('ability effect defaults derive from their character tuning', () => {
  const gloop = characterDefinitions.gloop.stats.tuning;
  assert.equal(EFFECT_RULES.gloopHookSlow.durationMs, gloop.special.hook.slowDurationMs);
  assert.equal(EFFECT_RULES.gloopSlimeSlow.modifiers.speedMult, gloop.attack.slimeball.slowSpeedMult);
  assert.deepEqual(EFFECT_RULES.thorgRage.modifiers, characterDefinitions.thorg.stats.tuning.special.rageModifiers);
});

test('zero slows survive projectile creation, contact and hook expiry', () => {
  const { buildProjectileBounceAttack } = require('../src/server/core/gameRoom/attackRuntimes/projectiles');
  const { applyDescriptorHitEffect } = require('../src/server/core/gameRoom/attackRuntimes/targets');
  const { buildHookProjectileAttack, applyGloopPull, tickRuntimeControlEffects } = require('../src/server/core/gameRoom/attackRuntimes/hook');
  const attacker = { participantId: 'a', name: 'Gloop', char_class: 'gloop', x: 100, y: 100 };
  const target = { participantId: 'b', name: 'Target', x: 200, y: 100, isAlive: true, loaded: true };
  const room = { players: new Map([['a', attacker], ['b', target]]), io: { to: () => ({ emit() {} }) } };
  const action = { slowSpeedMult: 0, slowJumpMult: 0, slowDurationMs: 100, maxBounces: 0, bounceDampingX: 0, bounceDampingY: 0, airDrag: 0, initialVy: 0, pullLockPaddingMs: 0 };
  const descriptor = { runtime: { slowSpeedMult: 0.8, slowJumpMult: 0.8, maxBounces: 2 }, events: { onHitEffect: { type: 'gloopSlimeSlow' } } };
  const slime = buildProjectileBounceAttack(attacker, action, descriptor, 10000);
  assert.equal(slime.maxBounces, 0);
  assert.equal(slime.bounceDampingX, 0);
  assert.equal(slime.bounceDampingY, 0);
  assert.equal(slime.vy, 0);
  applyDescriptorHitEffect(room, slime, descriptor, attacker, target, 10000);
  assert.equal(effects.getModifiers(target, 10000).speedMult, 0);
  assert.equal(effects.getModifiers(target, 10100).speedMult, 1);
  const hook = buildHookProjectileAttack(attacker, action, descriptor, 11000);
  applyGloopPull(room, attacker, target, hook, 11000);
  const pullEnd = target._gloopPullState.until;
  assert.equal(target._controlLockUntil, pullEnd);
  tickRuntimeControlEffects(room, pullEnd);
  assert.equal(effects.getModifiers(target, pullEnd).speedMult, 0);
  assert.equal(effects.getModifiers(target, pullEnd).jumpMult, 0);
  assert.equal(effects.getModifiers(target, pullEnd + 100).speedMult, 1);
});
