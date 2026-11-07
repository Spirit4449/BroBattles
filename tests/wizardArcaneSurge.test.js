const test = require('node:test');
const assert = require('node:assert/strict');
const surge = require('../src/server/core/gameRoom/abilities/wizardArcaneSurgeAbility');
const { POWERUP_CATALOG } = require('../src/shared/powerups');

function cast(random) {
  const applied = [], emitted = [];
  const player = (name, team) => ({ name, team, isAlive: true, loaded: true });
  const caster = player('wiz', 'team1');
  const room = {
    players: new Map([caster, player('ally', 'team1'), player('foe', 'team2')].map(p => [p.name, p])),
    _applyPowerupToPlayer: (target, type) => applied.push([target.name, type]),
    io: { to: () => ({ emit: (event, payload) => emitted.push(payload) }) },
  };
  const original = Math.random;
  Math.random = random;
  try { surge.activate(caster, Date.now(), room); } finally { Math.random = original; }
  return { applied, emitted };
}

test('the surge only hands out helpful powerups, and only to the caster\'s team', () => {
  for (const bad of ['poison', 'freeze', 'shockwave']) {
    assert.ok(POWERUP_CATALOG[bad], `${bad} is still a powerup`);
    assert.ok(!surge.SURGE_POWERUPS.includes(bad), `${bad} is never granted`);
  }
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const { applied, emitted } = cast(() => (i + 0.5) / 40);
    assert.deepEqual(applied.map(([name]) => name).sort(), ['ally', 'wiz']);
    for (const [, type] of applied) assert.ok(surge.SURGE_POWERUPS.includes(type), type);
    seen.add(applied.find(([name]) => name === 'wiz')[1]);
    assert.equal(emitted[0].recipients.find(r => r.isCaster).type, applied.find(([n]) => n === 'wiz')[1]);
  }
  assert.deepEqual([...seen].sort(), [...surge.SURGE_POWERUPS].sort(), 'the caster can roll any of them, not just rage');
});
