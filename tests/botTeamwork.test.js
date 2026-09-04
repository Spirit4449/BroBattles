const test = require('node:test');
const assert = require('node:assert/strict');
const { updateTeamwork, teamPosition } = require('../src/server/core/bots/teamwork');
const { chooseDecision } = require('../src/server/core/bots/tactics');
const { standOn } = require('../src/server/core/bots/navigation');
const { characterBody } = require('../src/shared/duelGeometry');

function setup(count = 3) {
  const allies = ['thorg', 'wizard', 'huntress'].slice(0, count).map((char_class, i) => ({
    participantId: `ally${i}`, team: 'blue', isBot: true, isAlive: true, loaded: true,
    char_class, x: 500 + i * 100, y: 500, health: 1000, maxHealth: 1000,
    ammoState: { charges: 3 }, lastDamagedAt: 0,
  }));
  const room = { players: new Map(allies.map((p) => [p.participantId, p])) };
  const brains = allies.map((player) => ({ room, player }));
  const enemy = { participantId: 'enemy', char_class: 'ninja', x: 1000, y: 500,
    health: 800, maxHealth: 1000, vx: 0, vy: 0 };
  function plan(now = 10000, enemies = [enemy]) {
    for (const brain of brains) brain.teamPlan = updateTeamwork(brain, { at: now, enemies }, now);
    return brains.map((b) => b.teamPlan);
  }
  return { allies, room, brains, enemy, plan };
}

test('healthy team splits a coordinated push into lead, support and opposite flank', () => {
  const h = setup(), plans = h.plan();
  assert.deepEqual(new Set(plans.map((p) => p.role)), new Set(['vanguard', 'support', 'flank']));
  assert.ok(plans.every((p) => p.strategy === 'push' && p.targetId === h.enemy.participantId));
  const lead = h.brains.find((b) => b.teamPlan.role === 'vanguard');
  const support = h.brains.find((b) => b.teamPlan.role === 'support');
  const flank = h.brains.find((b) => b.teamPlan.role === 'flank');
  assert.equal(support.teamPlan.buddyId, lead.player.participantId);
  assert.equal(flank.teamPlan.buddyId, lead.player.participantId);
  assert.equal(flank.teamPlan.side, -lead.teamPlan.side);
  assert.ok(teamPosition(lead, h.enemy).x < h.enemy.x);
  assert.ok(teamPosition(flank, h.enemy).x > h.enemy.x);
  assert.ok(teamPosition(support, h.enemy).x < lead.player.x);
  assert.equal(h.plan(10100)[0], plans[0], 'normal updates retain the plan');
});

test('wounding a teammate immediately changes roles to recovery and protection', () => {
  const h = setup();
  h.plan();
  h.allies[0].health = 200;
  h.allies[0].lastDamagedAt = 10100;
  const plans = h.plan(10100);
  assert.equal(plans[0].role, 'recover');
  const defender = h.brains.find((b) => b.teamPlan.role === 'defend');
  assert.ok(defender);
  assert.equal(defender.teamPlan.buddyId, h.allies[0].participantId);
  assert.equal(plans[0].buddyId, defender.player.participantId);
  const position = teamPosition(defender, h.enemy);
  assert.ok(position.x > h.allies[0].x && position.x < h.enemy.x, 'screens the retreat');
  assert.ok(plans.every((p) => p.strategy === 'protect'));
  h.allies[0].health = 900;
  assert.ok(h.plan(10200).every((p) => !['recover', 'defend'].includes(p.role)), 'roles adapt after healing');
});

test('bots can protect a wounded human teammate without assigning the human a role', () => {
  const h = setup(2);
  const human = { ...h.allies[0], participantId: 'human', isBot: false, health: 150, x: 850 };
  h.room.players.set('human', human);
  const plans = h.plan();
  assert.ok(plans.some((p) => p.role === 'defend' && p.buddyId === 'human'));
  assert.equal(h.room._botTeamwork.get('blue').plans.has('human'), false);
});

test('morale falls under injury and local pressure and recovers with health and support', () => {
  const h = setup();
  const initial = h.plan()[0].morale;
  h.allies[0].health = 250;
  h.allies[0].lastDamagedAt = 12500;
  h.allies[1].x = h.allies[2].x = 2000;
  const threats = [0, 1, 2].map((i) => ({ ...h.enemy, participantId: `enemy${i}`, x: 550 + i * 80 }));
  const shaken = h.plan(12500, threats)[0].morale;
  assert.ok(shaken < initial - 0.2);
  h.allies[0].health = 1000;
  h.allies[1].x = 600; h.allies[2].x = 700;
  assert.ok(h.plan(16000)[0].morale > shaken);
});

test('empty ammo favors holding, and a pair uses opposite sides without duplicate roles', () => {
  const h = setup(2);
  h.allies.forEach((p) => p.ammoState.charges = 0);
  assert.deepEqual(new Set(h.plan().map((p) => p.role)), new Set(['anchor', 'flank']));
  h.allies.forEach((p) => p.ammoState.charges = 3);
  assert.deepEqual(new Set(h.plan(13000).map((p) => p.role)), new Set(['vanguard', 'flank']));
});

test('casualties remove obsolete partners and solo survivors resume individual tactics', () => {
  const h = setup();
  h.plan();
  h.allies[0].isAlive = false;
  const survivor = h.brains[1];
  survivor.teamPlan = updateTeamwork(survivor, { at: 10100, enemies: [h.enemy] }, 10100);
  assert.notEqual(survivor.teamPlan.buddyId, h.allies[0].participantId);
  h.allies[2].isAlive = false;
  assert.equal(updateTeamwork(survivor, { at: 10200, enemies: [h.enemy] }, 10200), null);
});

test('stale enemy reports expire instead of tracking unseen opponents', () => {
  const h = setup();
  h.plan();
  for (const brain of h.brains) brain.teamPlan = updateTeamwork(brain, { at: 12000, enemies: [] }, 12000);
  assert.ok([...h.room._botTeamwork.get('blue').plans.values()].every((p) => !p.targetId));
});

test('roles produce different reachable movement goals, not just labels', () => {
  const h = setup();
  const floor = { id: 'floor', x: 1000, left: 0, right: 2000, top: 650, bottom: 700,
    collision: { up: true, down: true, left: true, right: true } };
  h.room.geometry = { mapId: 98745, world: { width: 2000, height: 1000 }, colliders: [floor] };
  h.room._powerups = new Map();
  h.allies.forEach((p) => Object.assign(p, standOn(floor, p.char_class, p.x)));
  h.enemy.y = h.allies[0].y;
  h.plan();
  const goals = new Map();
  for (const brain of h.brains) {
    Object.assign(brain, { profile: { prediction: 1, aimError: 0, tacticalAwareness: 0.8 }, spacing: 1,
      visited: new Map(), random: () => 0.5, surfaceEnteredAt: 10000 });
    const graph = { surfaces: [floor], body: characterBody(brain.player.char_class) };
    const context = { graph, current: floor, poisonY: Infinity, routeTo: () => [] };
    const decision = chooseDecision(brain, context, h.enemy, [h.enemy], 10000);
    goals.set(brain.teamPlan.role, decision.goal.x);
  }
  assert.ok(goals.get('flank') > h.enemy.x);
  assert.ok(goals.get('vanguard') < h.enemy.x);
  assert.ok(goals.get('support') < goals.get('vanguard'));
});
