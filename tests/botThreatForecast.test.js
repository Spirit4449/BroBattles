const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const { characterDefinitions } = require('../src/shared/characters');
const { requestBasic, requestSpecial, basicRange } = require('../src/shared/combat/combat.js');
const { botProfile } = require('../src/shared/combat/characterProfiles.js');
const { forecastThreats, FORECAST_MS } = require('../src/server/core/bots/threatForecast');
const { observe, threatShapes } = require('../src/server/core/bots/perception');

const DT = 1000 / 60;

// Every character's basic attack and super, fired the way bots fire them. The
// forecast bots dodge with must match, step for step, the damage shapes the
// real runtimes publish, until the attack first lands. An attack that deals
// damage without publishing its shape is invisible to bots and fails here.
function fight(t, character, kind, range) {
  let now = 1e6;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'log', () => {});
  const h = makeRoom({ characters: [character, 'ozzy'] });
  t.after(() => h.room.cleanup());
  h.room.botControllers.clear();
  h.room.matchData = { ...h.room.matchData, editorDebugHitboxes: true };
  const [attacker, target] = h.players;
  const floor = h.room.geometry.colliders.find((collider) => collider.id === 'p0');
  h.place(attacker, floor.left + 120, floor);
  h.place(target, range === 'close' ? attacker.x + Math.min(160, basicRange(attacker, h.room) * 0.5) : floor.right - 40, floor);
  for (const p of h.players) Object.assign(p, { connected: true, loaded: true });
  target.health = target.maxHealth = 1e9;
  const tick = () => { now += DT; h.tick(now); };
  for (let i = 0; i < 3; i++) tick();
  // A far target is out of reach: aim at the edge of range so the whole
  // flight is compared before anything is hit.
  const aim = range === 'close' ? target : { ...target, x: attacker.x + basicRange(attacker, h.room) * 0.9 };
  const requested = kind === 'super'
    ? (attacker.superCharge = attacker.maxSuperCharge, requestSpecial(h.room, attacker, aim, now))
    : requestBasic(h.room, attacker, aim, botProfile(character), () => 0.5, now);
  return { h, attacker, target, requested, tick, now: () => now };
}

const published = (room, attacker) => new Map([...(room.damageHitboxes || [])]
  .filter(([, shape]) => shape.owner === attacker.name)
  .map(([id, { expiresAt, owner, ...shape }]) => [id.slice(0, id.lastIndexOf(':')), shape]));
const realState = (room) => JSON.stringify([room.activeAttacks, room._scheduledActions?.length,
  [...(room.ninjaCombatState?.active.values() || [])].map((entry) => entry.projectile),
  [...(room.sparrowCombatState?.active.values() || [])].map((entry) => [entry.x, entry.y]),
  [...room.players.values()].map((p) => [p.x, p.y, p.team, p.health, p.ammoState, p.effects])],
(key, value) => value instanceof Map || value instanceof Set ? [...value] : value);

const LIFETIME_STEPS = 300;
for (const character of Object.keys(characterDefinitions)) for (const kind of ['basic', 'super']) for (const range of ['far', 'close']) {
  test(`bots forecast ${character}'s ${kind} where it deals damage (${range} target)`, (t) => {
    const { h, attacker, target, requested, tick, now } = fight(t, character, kind, range);
    assert.ok(requested, `${character} ${kind} was accepted`);
    let compared = 0, seen = 0, landed = false;
    // Each step reads the shared forecast as bots do: reused while no attack
    // starts or ends, and read at its age.
    for (let step = 0; step < LIFETIME_STEPS; step++) {
      const before = realState(h.room);
      const forecast = forecastThreats(h.room);
      assert.equal(forecast.error, null);
      assert.equal(realState(h.room), before, 'forecasting leaves the room untouched');
      h.room.damageHitboxes?.clear();
      const health = target.health;
      tick();
      const shapes = published(h.room, attacker);
      seen += shapes.size;
      // The forecast has nobody to hit, so it ends where a hit changes the
      // attack (a burst, a stall, a pull).
      if (target.health < health) { landed = true; break; }
      const index = Math.round((now() - forecast.at) / DT) - 1;
      for (const [id, shape] of shapes) {
        const predicted = forecast.threats.find((threat) => threat.id === id)?.steps[index];
        assert.ok(predicted?.length, `${id} was forecast ${index + 1} steps ahead`);
        assert.deepEqual(predicted.at(-1), shape);
        compared++;
      }
      if (seen && !shapes.size && !forecastThreats(h.room).threats.length) break;
    }
    if (landed) assert.ok(seen, `${character} ${kind} dealt damage without publishing where`);
    if (range === 'far' && seen) assert.ok(compared, 'the flight before any hit was compared');
    // Self buffs publish no damage shape and are not threats.
    if (!seen) assert.equal(forecastThreats(h.room).threats.length, 0);
  });
}

test('bots read a reused forecast at its age and ignore their own team', (t) => {
  const { h, attacker, tick } = fight(t, 'sparrow', 'basic', 'far');
  const enemy = h.players[1];
  while (!h.room.sparrowCombatState.active.size) tick();
  forecastThreats(h.room);
  tick(); tick();
  const [threat] = observe(h.room, enemy, Date.now()).projectiles;
  assert.ok(threat.ageS > 0);
  h.room.damageHitboxes?.clear();
  tick();
  const [shape] = published(h.room, attacker).values();
  assert.deepEqual(threatShapes(threat, 1 / 60).at(-1), shape);
  assert.equal(observe(h.room, attacker, Date.now()).projectiles.length, 0);
});
