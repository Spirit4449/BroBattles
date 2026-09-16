const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const { registerAttackFromAction, tickActiveAttacks } = require('../src/server/core/gameRoom/attackRuntimeManager');
const { getAttackCollisionCenter } = require('../src/server/core/gameRoom/attackRuntimes/geometry');

function fixture(t, character) {
  const f = makeRoom({ characters: [character, 'wizard'] });
  t.after(() => f.room.cleanup());
  const [owner, target] = f.players;
  Object.assign(owner, { x: 100, y: 200, connected: true, isBot: false });
  Object.assign(target, { x: 2500, y: 200, connected: true, _bodyHalfWidth: 20,
    _bodyHalfHeight: 40, _bodyCenterOffsetX: 0, _bodyCenterOffsetY: 0 });
  f.room.geometry = { ...f.room.geometry, colliders: [] };
  f.room.gameMode = null;
  f.step = (count = 1) => {
    for (let i = 0; i < count; i++) tickActiveAttacks(f.room, Date.now());
  };
  f.release = () => {
    registerAttackFromAction(f.room, owner, {
      type: character === 'wizard' ? 'wizard-fireball-release' : 'gloop-slimeball-release',
      id: 'released', start: { x: 130, y: 192 }, angle: 0, direction: 1,
    });
    return f.room._activeAttacks[0];
  };
  return f;
}

for (const character of ['wizard', 'gloop']) {
  test(`${character}: released projectile moves and damages after actual owner death`, t => {
    const f = fixture(t, character), [owner, target] = f.players;
    const shot = f.release(), hp = target.health;
    f.room._handlePlayerDeath(owner);
    f.step(3);
    assert.ok(shot.x > 130);
    assert.ok(f.room._activeAttacks.includes(shot));
    // The projectile owns its collision position even if the owner moves on respawn.
    owner.x = 3000; owner._posHistory = [];
    const center = getAttackCollisionCenter(shot);
    target.x = center.x + 15; target.y = center.y;
    f.step(3);
    assert.equal(target.health, hp - owner.baseDamage);
    f.step(3);
    assert.equal(target.health, hp - owner.baseDamage, 'no duplicate hit');
    if (character === 'gloop') assert.ok(target.activeEffects?.gloopSlimeSlow || target.effects?.gloopSlimeSlow);
    const callbacks = [];
    f.room.scheduleAction = fn => callbacks.push(fn);
    f.room.handlePlayerAction(owner.participantId, {
      type: character === 'wizard' ? 'wizard-fireball' : 'gloop-slimeball', id: 'dead-cast', angle: 0,
    });
    assert.equal(callbacks.length, 0, 'dead owners cannot start another cast');
  });

  test(`${character}: surviving flight expires normally and disconnect still cancels it`, t => {
    const f = fixture(t, character), [owner, target] = f.players;
    target.loaded = false;
    f.release();f.room._handlePlayerDeath(owner);f.step(1000);
    assert.equal(f.room._activeAttacks.length, 0);
    owner.isAlive = true;
    f.room._recentAttackInstances.clear();
    f.release();owner.connected = false;f.step();
    assert.equal(f.room._activeAttacks.length, 0);
  });

  test(`${character}: dead client hits and unregistered server contacts cannot bypass death checks`, t => {
    const f = fixture(t, character), [owner, target] = f.players;
    const shot = f.release(), hp = target.health;
    f.room._handlePlayerDeath(owner);
    const payload = { attacker: owner.name, target: target.name, attackType: shot.attackType, instanceId: shot.instanceId };
    f.room.handleHit(owner.participantId, payload);
    f.room.handleHit(owner.participantId, payload, { server: true, runtimeProjectile: shot });
    f.room.handleHit(owner.participantId, payload, { server: true,
      runtimeProjectile: { ...shot, contactTarget: target.name } });
    assert.equal(target.health, hp);
  });

  test(`${character}: death during windup prevents release`, t => {
    const f = fixture(t, character), [owner] = f.players, callbacks = [];
    f.room.scheduleAction = fn => callbacks.push(fn);
    f.room.handlePlayerAction(owner.participantId, {
      type: character === 'wizard' ? 'wizard-fireball' : 'gloop-slimeball', id: 'windup', angle: 0,
    });
    assert.ok(callbacks.length);
    f.room._handlePlayerDeath(owner);
    callbacks.forEach(fn => fn());
    assert.equal(f.room._activeAttacks?.length || 0, 0);
  });
}

test('player-attached melee and hook attacks still stop on death', t => {
  for (const [character, type] of [['draven', 'draven-splash'], ['thorg', 'thorg-fall'], ['gloop', 'gloop-hook-release']]) {
    const f = fixture(t, character), [owner, target] = f.players, hp = target.health;
    assert.equal(registerAttackFromAction(f.room, owner, { type, id: type, angle: 0 }), true, type);
    f.room._handlePlayerDeath(owner);f.step();
    assert.equal(f.room._activeAttacks.length, 0, type);
    assert.equal(target.health, hp, type);
  }
});
