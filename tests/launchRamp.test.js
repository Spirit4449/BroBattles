const test = require('node:test');
const assert = require('node:assert/strict');
const { launchTravel, launchLagMs, launchDurationMs } = require('../src/shared/combat/launchRamp');
const { getResolvedCharacterAttackConfig } = require('../src/shared/characters/characterTuning');

const fireball = getResolvedCharacterAttackConfig('wizard', 'fireball');

test('an eased launch starts slow, speeds up without jumps, then holds full speed', () => {
  const cfg = { speed: 400, launchEaseMs: 200, launchStartSpeed: 0.25 };
  const speedAt = ms => (launchTravel(ms + 1, cfg) - launchTravel(ms, cfg)) * 1000;
  assert.ok(Math.abs(speedAt(0) - 100) < 2, 'leaves at the start fraction');
  let last = speedAt(0);
  for (let ms = 0; ms <= 400; ms += 5) {
    const speed = speedAt(ms);
    assert.ok(speed >= last - 1e-6, `never slows down at ${ms} ms`);
    assert.ok(speed - last < 15, `no sudden kick at ${ms} ms`);
    last = speed;
  }
  assert.ok(Math.abs(speedAt(300) - 400) < 1e-6);
  // Once at speed it runs a fixed lag behind a constant-speed shot.
  assert.ok(Math.abs(launchTravel(600, cfg) - 400 * (0.6 - launchLagMs(cfg) / 1000)) < 1e-6);
});

test('without an ease the curve is constant speed', () => {
  const cfg = { speed: 450 };
  assert.equal(launchTravel(1000, cfg), 450);
  assert.equal(launchLagMs(cfg), 0);
  assert.equal(launchDurationMs(900, cfg), 2000);
});

test('the launch duration covers exactly the range, inside or past the ease', () => {
  const cfg = { speed: 450, launchEaseMs: 280, launchStartSpeed: 0.28 };
  for (const range of [20, 80, 1050]) {
    assert.ok(Math.abs(launchTravel(launchDurationMs(range, cfg), cfg) - range) < 1e-3, `range ${range}`);
  }
});

test('the server moves the fireball along the same curve the client draws', () => {
  assert.ok(fireball.launchEaseMs > 0 && fireball.launchStartSpeed < 1, 'wizard eases its launch');
  const { createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const player = { name: 'A', socketId: 'a', x: 500, y: 300, isAlive: true, loaded: true, team: 'team1' };
  const room = { players: new Map([['a', player]]), FIXED_DT_MS: 1000 / 60,
    geometry: { world: { x: 0, y: 0, width: 4000, height: 1000 } } };
  const now = Date.now();
  const angle = -0.4;
  const attack = createRuntimeAttack(player, { type: 'wizard-fireball-release', id: 'f', angle }, now);
  const start = { x: attack.x, y: attack.y };
  let done = false, ticks = 0;
  while (!done && ticks < 400) {
    ticks++;
    done = tickRuntimeAttack(room, attack, now + ticks * room.FIXED_DT_MS);
    const expected = launchTravel(ticks * room.FIXED_DT_MS, fireball);
    assert.ok(Math.abs(Math.hypot(attack.x - start.x, attack.y - start.y) - expected) < 1e-6, `tick ${ticks}`);
  }
  assert.ok(done, 'the fireball ends at its range');
  assert.ok(Math.abs(ticks * room.FIXED_DT_MS - launchDurationMs(fireball.range, fireball)) <= room.FIXED_DT_MS,
    'the client flight duration matches the server lifetime');
});
