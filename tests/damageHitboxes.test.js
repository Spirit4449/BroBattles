const test = require('node:test');
const assert = require('node:assert/strict');
const { exposeDamageHitbox, damageHitboxSnapshot, SAMPLE_TTL_MS } = require('../src/server/core/gameRoom/damageHitboxes');
const { hitCircleTargets, hitRectTargets } = require('../src/server/core/gameRoom/attackRuntimes/targets');

test('damage geometry is debug-only, replaced per source, and expires even after attack removal', () => {
  const room = { matchData: {} }, source = { attackerName: 'A', instanceId: 'shot' };
  exposeDamageHitbox(room, source, { kind: 'circle', x: 0, y: 0, radius: 8 }, 100);
  assert.equal(room._damageHitboxes, undefined);
  assert.equal(damageHitboxSnapshot(room, 100), undefined);
  room.matchData.editorDebugHitboxes = true;
  exposeDamageHitbox(room, source, { kind: 'circle', x: 0, y: 0, radius: 8 }, 100);
  exposeDamageHitbox(room, source, { kind: 'circle', x: 10, y: 0, radius: 8 }, 110);
  exposeDamageHitbox(room, { ...source, instanceId: 'shot2' }, { kind: 'rect', left: 0, right: 5, top: 0, bottom: 5 }, 110);
  const shapes = damageHitboxSnapshot(room, 115);
  assert.equal(shapes.length, 2);
  assert.equal(shapes[0].x, 10);
  assert.deepEqual(damageHitboxSnapshot(room, 110 + SAMPLE_TTL_MS), []);
  assert.equal(room._damageHitboxes.size, 0);
});

test('shared target queries expose damage shapes even when there are no enemies', () => {
  const player = { name: 'A', isAlive: true, team: 'team1' };
  const room = { matchData: { editorDebugHitboxes: true }, players: new Map([['a', player]]) };
  const attack = { attackerParticipantId: 'a', attackerName: 'A', instanceId: 'one' };
  hitCircleTargets(room, attack, {}, 40, 50, 12, 100);
  assert.deepEqual(damageHitboxSnapshot(room, 100)[0], { id: 'A:one:body', kind: 'circle', x: 40, y: 50, radius: 12, expiresAt: 220 });
  hitRectTargets(room, { ...attack, instanceId: 'two' }, {}, { left: 1, right: 9, top: 2, bottom: 10 }, 100);
  assert.equal(damageHitboxSnapshot(room, 100)[1].kind, 'rect');
});

test('every registered generic damage runtime publishes its collision geometry without targets', () => {
  const { ATTACK_RUNTIMES, createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const { attackDescriptors } = require('../src/shared/characters');
  const covered = new Set();
  const now = Date.now();
  for (const [type, descriptor] of Object.entries(attackDescriptors)) {
    if (!ATTACK_RUNTIMES[descriptor.runtime?.kind]) continue;
    const player = { name: 'A', socketId: 'a', x: 500, y: 300, isAlive: true, loaded: true, team: 'team1', effects: {} };
    const room = { matchData: { editorDebugHitboxes: true }, players: new Map([['a', player]]), FIXED_DT_MS: 16.667, geometry: { colliders: [], world: { x: 0, y: 0, width: 3600, height: 2000 } } };
    const created = createRuntimeAttack(player, { type, id: type, direction: 1, angle: 0 }, now);
    const attacks = Array.isArray(created) ? created : [created];
    for (const attack of attacks) {
      assert.ok(attack, type);
      for (let step = 0; step < 100; step++) {
        if (tickRuntimeAttack(room, attack, now + step * room.FIXED_DT_MS)) break;
      }
    }
    assert.ok(room._damageHitboxes?.size > 0, `${type} must expose a damage volume`);
    covered.add(descriptor.runtime.kind);
  }
  // Cone is supported for future attacks but has no current descriptor.
  const player = { name: 'A', socketId: 'a', x: 100, y: 100, isAlive: true };
  const room = { matchData: { editorDebugHitboxes: true }, players: new Map([['a', player]]) };
  const descriptor = { runtime: { kind: 'attached-cone', radius: 100, spreadDeg: 60, activeWindowMs: 100 } };
  const attack = ATTACK_RUNTIMES['attached-cone'].create(player, { id: 'cone' }, descriptor, now);
  ATTACK_RUNTIMES['attached-cone'].tick(room, attack, descriptor, now + 50);
  assert.equal(damageHitboxSnapshot(room, now + 50)[0].kind, 'sector');
  covered.add('attached-cone');
  assert.deepEqual([...covered].sort(), Object.keys(ATTACK_RUNTIMES).sort());
});

test('configured projectile offsets align Wizard and Gloop collision with their art', () => {
  const { createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
  const now = Date.now();
  for (const [type, expectedOffset, expectedOffsetY] of [
    ['wizard-fireball-release', -90, 16],
    ['gloop-hook-release', 28, 50],
  ]) {
    const player = { name: 'A', socketId: 'a', x: 500, y: 300, isAlive: true, loaded: true, team: 'team1' };
    const room = {
      matchData: { editorDebugHitboxes: true },
      players: new Map([['a', player]]),
      FIXED_DT_MS: 250,
      geometry: { world: { x: 0, y: 0, width: 2000, height: 1000 } },
    };
    const attack = createRuntimeAttack(player, { type, id: type, angle: 0 }, now);
    tickRuntimeAttack(room, attack, now + 250);
    const shape = damageHitboxSnapshot(room, now + 250)[0];
    assert.equal(shape.kind, 'circle');
    assert.ok(Math.abs(shape.x - (attack.x + expectedOffset)) < 1e-9, type);
    assert.equal(shape.y, attack.y + expectedOffsetY);
  }
});

test('rearward projectile correction cannot damage behind its launch point', () => {
  const { getAttackCollisionCenter } = require('../src/server/core/gameRoom/attackRuntimes/geometry');
  const attack = { x: 107, y: 50, angle: 0, traveled: 7, collisionForwardOffset: -90 };
  assert.deepEqual(getAttackCollisionCenter(attack), { x: 100, y: 50 });
});

test('dedicated Ninja and Huntress protocols expose each basic and special projectile', t => {
  const { makeRoom } = require('./helpers/botRoom');
  for (const character of ['ninja', 'huntress']) {
    const combat = require(`../src/server/core/gameRoom/${character}Combat`);
    for (const special of [false, true]) {
      const { room, players } = makeRoom({ characters: [character, 'wizard'] });
      t.after(() => room.cleanup());
      room.matchData.editorDebugHitboxes = true;
      room.geometry = { ...room.geometry, colliders: [] };
      room._tickId = 0; room._simulationMono = 0;
      const player = players[0];
      Object.assign(player, { x: 500, y: 200, connected: true, superCharge: player.maxSuperCharge });
      players[1].loaded = false;
      assert.equal(combat.request(room, player, { id: 'debug', angle: 0, power: 1, aim: { angle: 0, power: 1 } }, special), true);
      for (let step = 0; step < 60; step++) {
        room._tickId++; room._simulationMono += 1000 / 60;
        combat.tick(room);
      }
      const shapes = damageHitboxSnapshot(room);
      assert.ok(shapes.length >= (special ? 2 : 1), `${character} ${special ? 'special' : 'basic'}`);
      assert.ok(shapes.every(shape => shape.kind === 'sweep'));
    }
  }
});

test('overlay follows the debug toggle and cleans up stale frames and scene listeners', () => {
  const { EventEmitter } = require('node:events');
  const fs = require('node:fs'), vm = require('node:vm'), babel = require('@babel/core');
  const moduleExports = {};
  let now = 100, circles = 0, destroyed = false;
  vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/damageHitboxDebug.js'), 'utf8'), {
    babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code, { exports: moduleExports, Date: { now: () => now } });
  const graphics = { setDepth() { return this; }, clear() {}, lineStyle() {}, strokeCircle() { circles++; }, destroy() { destroyed = true; } };
  const events = new EventEmitter(), socket = new EventEmitter();
  const scene = { add: { graphics: () => graphics }, events, physics: { world: { drawDebug: true } }, cameras: { main: { zoom: 1 } } };
  moduleExports.installDamageHitboxDebug(scene, socket);
  socket.emit('game:snapshot', { damageHitboxes: [{ kind: 'circle', x: 10, y: 20, radius: 8 }] });
  events.emit('postupdate'); assert.equal(circles, 1);
  scene.physics.world.drawDebug = false;
  events.emit('postupdate'); assert.equal(circles, 1);
  scene.physics.world.drawDebug = true; now += 251;
  events.emit('postupdate'); assert.equal(circles, 1);
  events.emit('shutdown');
  assert.equal(socket.listenerCount('game:snapshot'), 0);
  assert.equal(events.listenerCount('postupdate'), 0);
  assert.equal(destroyed, true);
});
