const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const { registerAttackFromAction, tickActiveAttacks } = require('../src/shared/combat/runtime/attackRuntimeManager.js');
const { getResolvedCharacterAttackConfig } = require('../src/shared/characters/characterTuning');

const FIREBALL = getResolvedCharacterAttackConfig('wizard', 'fireball');

// Wizard (team1), then alternating teams: enemies are Player1 and Player3.
function arena(t, characters = ['wizard', 'ninja', 'ninja', 'ninja']) {
  const f = makeRoom({ characters });
  t.after(() => f.room.cleanup());
  f.room.geometry = { ...f.room.geometry, colliders: [] };
  f.room.gameMode = null;
  const [owner, ...others] = f.players;
  Object.assign(owner, { x: 100, y: 200, connected: true, isBot: false });
  for (const p of others) Object.assign(p, { x: 3000, y: 200, connected: true, _bodyHalfWidth: 20,
    _bodyHalfHeight: 40, _bodyCenterOffsetX: 0, _bodyCenterOffsetY: 0, _posHistory: [] });
  f.fire = () => {
    registerAttackFromAction(f.room, owner, { type: 'wizard-fireball-release', id: 'boom', start: { x: 130, y: 200 }, angle: 0, direction: 1 });
    return f.room._activeAttacks[0];
  };
  f.flyOut = () => {
    for (let i = 0; i < 400 && f.room._activeAttacks.length; i++) tickActiveAttacks(f.room, Date.now());
    assert.equal(f.room._activeAttacks.length, 0, 'the fireball ended');
  };
  f.impacts = () => f.events.filter(e => e.payload?.action?.type === 'wizard-fireball-impact').map(e => e.payload.action);
  return f;
}

test('the fireball stops on the first enemy and splashes everyone near the burst once', t => {
  // Teams alternate: Player1, 3 and 5 are enemies; Player2 and 4 are allies.
  const f = arena(t, ['wizard', 'ninja', 'ninja', 'ninja', 'ninja', 'ninja']);
  const [owner, front, ally, behind, , far] = f.players;
  assert.ok(FIREBALL.splashRadius > FIREBALL.collisionRadius, 'the splash reaches past the contact');
  front.x = 600;
  // The burst is centred on the enemy the ball strikes.
  const burstX = front.x;
  // Inside the splash, though the ball never reaches it.
  behind.x = burstX + FIREBALL.splashRadius + 20 - 8;
  ally.x = front.x + 10;
  // Further along the line, outside the splash.
  far.x = burstX + FIREBALL.splashRadius + 120;
  const hp = new Map(f.players.map(p => [p.name, p.health]));
  const shot = f.fire();
  f.flyOut();
  assert.equal(front.health, hp.get(front.name) - owner.baseDamage);
  assert.equal(behind.health, hp.get(behind.name) - owner.baseDamage, 'splashed once');
  assert.equal(ally.health, hp.get(ally.name), 'teammates are never splashed');
  assert.equal(far.health, hp.get(far.name), 'the ball stopped before reaching it');
  const impacts = f.impacts();
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].id, shot.instanceId);
  assert.ok(Math.abs(impacts[0].x - burstX) < 1e-6, `burst at ${impacts[0].x}, expected ${burstX}`);
  assert.ok(Math.abs(impacts[0].y - 200) < 1e-6, 'at the centre of its body');
});

test('a fireball that touches nothing bursts at the end of its range', t => {
  const f = arena(t, ['wizard', 'ninja']);
  const [, enemy] = f.players;
  const hp = enemy.health;
  const shot = f.fire();
  f.flyOut();
  assert.equal(enemy.health, hp);
  const [impact] = f.impacts();
  assert.ok(impact, 'clients are told where it burst');
  assert.ok(Math.abs(impact.x - (130 + FIREBALL.range + FIREBALL.collisionForwardOffset)) < 10, `burst at ${impact.x}`);
  assert.equal(shot.splashRadius, FIREBALL.splashRadius);
});

test('an enemy standing in the end-of-range burst is splashed', t => {
  const f = arena(t, ['wizard', 'ninja']);
  const [owner, enemy] = f.players;
  enemy.x = 130 + FIREBALL.range + FIREBALL.splashRadius - 10;
  const hp = enemy.health;
  f.fire();
  f.flyOut();
  assert.equal(enemy.health, hp - owner.baseDamage);
});

const { handleCharacterAction } = require('../src/shared/combat/runtime/characterActionRegistry.js');
const { wizardChargeShapes, chargeConfig } = require('../src/shared/characters/wizardCharge');
function castAt(f, now) {
  const [owner] = f.players;
  handleCharacterAction(f.room, owner, { type: 'wizard-fireball', id: 'cast', angle: 0, direction: 1, damage: owner.baseDamage }, now);
  const release = () => { for (const job of f.room._scheduledActions.splice(0)) job.callback(); };
  const tickTo = ms => { for (let t = 0; t <= ms; t += f.room.FIXED_DT_MS) tickActiveAttacks(f.room, now + t); };
  const releases = () => f.events.filter(e => e.payload?.action?.type === 'wizard-fireball-release');
  return { owner, release, tickTo, releases };
}

test('the charging ball burns an enemy on top of or behind the wizard and replaces the release', t => {
  const f = arena(t, ['wizard', 'ninja', 'ninja', 'ninja']);
  const [, behind, , onTop] = f.players;
  const cfg = chargeConfig();
  const [{ a, b }] = wizardChargeShapes({ x: 100, y: 200, flip: false }, cfg.startMs);
  assert.ok(a.x < 100 && b.y < 200 - 30, 'the zone sits behind him and over his head');
  behind.x = 62; behind.y = 196;
  onTop.x = 108 + 20; onTop.y = 200 - 46 - 40 + 30; // standing on his head, just inside the splash
  const hp = new Map(f.players.map(p => [p.name, p.health]));
  const now = Date.now();
  const cast = castAt(f, now);
  cast.tickTo(cfg.startMs - f.room.FIXED_DT_MS);
  assert.equal(behind.health, hp.get(behind.name), 'nothing burns before the charge is live');
  cast.tickTo(cfg.startMs + 40);
  assert.equal(behind.health, hp.get(behind.name) - cast.owner.baseDamage, 'burned during the cast');
  assert.equal(onTop.health, hp.get(onTop.name) - cast.owner.baseDamage, 'the burst splashes too');
  const [impact] = f.impacts();
  assert.equal(impact.id, 'cast', 'clients burst the charging ball by its id');
  cast.release();
  assert.equal(cast.releases().length, 0, 'a ball that already burst is not released');
});

test('with no one in the charge zone the fireball releases as normal', t => {
  const f = arena(t, ['wizard', 'ninja']);
  const [, enemy] = f.players;
  enemy.x = 160; enemy.y = 200; // right in front: the released ball's job
  const hp = enemy.health;
  const now = Date.now();
  const cast = castAt(f, now);
  cast.tickTo(chargeConfig().endMs + 40);
  assert.equal(enemy.health, hp, 'the charge never reaches in front of him');
  assert.equal(f.room._activeAttacks.length, 0, 'the charge ends with the windup');
  cast.release();
  assert.equal(cast.releases().length, 1);
});

test('a client cannot trigger the charge hitbox on its own', t => {
  const f = arena(t, ['wizard', 'ninja']);
  const [owner, enemy] = f.players;
  enemy.x = 62; enemy.y = 196;
  const result = handleCharacterAction(f.room, owner, { type: 'wizard-fireball-charge', id: 'x' }, Date.now());
  assert.equal(result?.handled, true);
  assert.equal((f.room._activeAttacks || []).length, 0);
});
