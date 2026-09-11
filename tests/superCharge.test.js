const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const { getSuperChargeHits, getSuperChargePerHit } = require("../src/shared/characterStats.js");
const inferno = require('../src/server/core/gameRoom/abilities/dravenInfernoAbility');

function fixture(t, character = 'draven') {
  const f = makeRoom({ characters: [character, 'wizard'] });
  t.after(() => f.room.cleanup());
  const [p, target] = f.players;
  Object.assign(p, { x: 100, y: 200, connected: true });
  Object.assign(target, { x: 130, y: 200, health: 100000, maxHealth: 100000 });
  f.hit = (id, attackType = 'basic') => f.room.handleHit(p.participantId, {
    attacker: p.name, target: target.name, instanceId: id, attackType,
  }, { server: true });
  return f;
}

test('character charge requirements are hit counts at every level', t => {
  const { room } = fixture(t);
  for (const [character, hits] of Object.entries({ ninja: 6, thorg: 3, draven: 4, wizard: 5, huntress: 6, gloop: 6 })) {
    for (const level of [1, 5, 10]) assert.equal(room._computeStats(character, level).specialChargeHits, hits);
    assert.equal(getSuperChargeHits(character), hits);
    assert.equal(getSuperChargePerHit(character, 'basic'), 1);
  }
});

test('weak, boosted, ducked and lethal hits grant the same charge; duplicates do not', t => {
  const { players: [p, target], hit } = fixture(t);
  p.baseDamage = 1;
  hit('weak');
  assert.equal(p.superCharge, 1);
  hit('weak');
  assert.equal(p.superCharge, 1);
  p.baseDamage = 5000;
  target.ducking = true;
  hit('strong');
  assert.equal(p.superCharge, 2);
  target.ducking = false;
  target.health = 1;
  hit('lethal');
  assert.equal(p.superCharge, 3);
});

test('only configured supers grant charge and charge caps at ready', t => {
  for (const [character, gain] of [['draven', .25], ['thorg', 0], ['wizard', 0], ['gloop', 0]]) {
    const { players: [p], hit } = fixture(t, character);
    hit('super', 'special');
    assert.equal(p.superCharge, gain);
    p.superCharge = p.maxSuperCharge - .25;
    hit('normal');
    assert.equal(p.superCharge, p.maxSuperCharge);
  }
  assert.equal(getSuperChargePerHit('ninja', 'ninja-special-swarm'), .25);
  assert.equal(getSuperChargePerHit('huntress', 'huntress-burning-arrow'), 1);
  assert.equal(getSuperChargePerHit('huntress', 'huntressBurn'), 0);
});

test('each registered arrow in one volley grants one hit, including simultaneous contacts', t => {
  const { room, players: [p, target] } = fixture(t, 'huntress');

  for (let i = 0; i < 3; i++) {
    const id = `volley:${i}`;
    const arrow = { projectile: { id }, attackerName: p.name, attackType: 'huntress-arrow' };
    room._huntress.active.set(id, arrow);
    const payload = { attacker: p.name, target: target.name, instanceId: id, attackType: arrow.attackType };
    room.handleHit(p.participantId, payload, { server: true, huntressProjectile: arrow });
    room.handleHit(p.participantId, payload, { server: true, huntressProjectile: arrow });
    room._huntress.active.delete(id);
  }
  assert.equal(p.superCharge, 3);
});

test('Inferno charges per successful tick, skips shields, and publishes fractional charge', t => {
  const { room, players: [p, target], events } = fixture(t);
  inferno.activate(p, 1000);
  inferno.tick(room, p, 1100);
  assert.equal(p.superCharge, .25);
  inferno.tick(room, p, 1101);
  assert.equal(p.superCharge, .25);
  require('../src/server/core/gameRoom/effects/effectManager').apply(target, 'respawnShield', 1101, { durationMs: 3000 }, room);
  inferno.tick(room, p, 1400);
  assert.equal(p.superCharge, .25);
  assert.equal(events.filter(e => e.type === 'super-update').at(-1).payload.charge, .25);
});

test('authoritative client sync preserves fractional super charge', async () => {
  const { createLocalStateSync } = await import('../src/players/localStateSync.js');
  let charge, max;
  const sync = createLocalStateSync({
    setSuperCharge: value => { charge = value; },
    setMaxSuperCharge: value => { max = value; },
    updateHealthBar() {},
  });
  sync.applyAuthoritativeState({ superCharge: 3.75, maxSuperCharge: 4 });
  assert.equal(charge, 3.75);
  assert.equal(max, 4);
});
