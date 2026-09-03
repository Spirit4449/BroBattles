const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const { bounds } = require('../src/server/core/bots/physics');
const { standOn } = require('../src/server/core/bots/navigation');
const { observe, incomingThreat } = require('../src/server/core/bots/perception');
const { preferredRange } = require('../src/server/core/bots/tactics');
const { basicAim } = require('../src/server/core/bots/combat');
const { SUPER_RANGES, updateSuperPlan, shouldUseSuper } = require('../src/server/core/bots/supers');
const { difficultyForTrophies } = require('../src/server/core/bots/config');
const { registerAttackFromAction, tickActiveAttacks } = require('../src/server/core/gameRoom/attackRuntimeManager');
const effects = require('../src/server/core/gameRoom/effects/effectManager');

function setup(t, characters = ['wizard', 'ninja'], trophies = 1000) {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'log', () => {});
  const h = makeRoom({ characters, trophies, seed: 17 });
  t.after(() => h.room.cleanup());
  const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
  for (const id of h.room.botControllers.keys()) if (id !== p.participantId) h.room.botControllers.delete(id);
  h.players.forEach((player, i) => h.place(player, 1000 + i * 250));
  h.room._lastPowerupSpawnAt = now;
  const snapshot = () => observe(h.room, p, now, brain.projectileSamples);
  const think = () => brain.think(snapshot(), effects.getModifiers(p, now), now);
  function advance(frames, pickups = false) {
    for (let i = 0; i < frames; i++) {
      now += 1000 / 60;
      h.tick(now);
      if (pickups) h.room._tickPowerups();
    }
  }
  return { ...h, p, brain, snapshot, think, advance, now: () => now };
}

test('bots pause at the opening and hold good firing ground without jumping or pacing', (t) => {
  const h = setup(t), enemy = h.players[1];
  h.brain.random = () => 0.9;
  h.brain.openingDelay = 700;
  enemy.health = enemy.maxHealth = 1000000;
  h.place(enemy, h.p.x + preferredRange(h.brain, enemy));
  const x = h.p.x;
  h.advance(30);
  assert.equal(h.p.x, x);
  assert.equal(h.brain.metrics.attacks, 0);
  h.advance(210);
  assert.ok(Math.abs(h.p.x - x) < 24, 'holds a comfortable firing position');
  assert.equal(h.brain.metrics.jumps, 0);
  assert.ok(h.brain.metrics.idleMs > 2500);
  assert.ok(h.brain.metrics.attacks > 0, 'standing still does not stop fighting');
});

test('periodic idle does not interrupt an active fight', (t) => {
  const h = setup(t), enemy = h.players[1];
  h.brain.openingDelay = 0;
  h.brain.openingUntil = 0;
  h.brain.nextIdleAt = 0;
  h.brain.random = () => 0.5;
  h.place(enemy, h.p.x + preferredRange(h.brain, enemy));
  h.think();
  assert.equal(h.brain.decision.mode, 'fight');
  assert.equal(h.brain.idleUntil, 0);
});

test('bots hesitate after ammo becomes technically ready instead of frame-perfect firing', (t) => {
  const h = setup(t, ['ninja', 'wizard']);
  h.brain.random = () => 0.5;
  h.brain.openingDelay = 0;
  h.brain.openingUntil = 0;
  const enemy = h.players[1];
  h.place(enemy, h.p.x + 160);
  const observed = h.snapshot();
  h.brain.tryCombat(observed.enemies, observed.enemies[0], observed, h.now());
  assert.equal(h.brain.metrics.attacks, 1);
  const technicalReady = h.now() + h.p.ammoState.cooldownMs;
  assert.ok(h.brain.ammoReadyAfter > technicalReady);
  h.p._botActionUntil = 0;
  h.p.ammoState.nextFireInMs = 0;
  h.p.ammoState.charges = 1;
  h.brain.nextOpportunity = 0;
  h.brain.tryCombat(observed.enemies, observed.enemies[0], observed, technicalReady + 1);
  assert.equal(h.brain.metrics.attacks, 1, 'does not fire on the first available frame');
  h.brain.tryCombat(observed.enemies, observed.enemies[0], observed, h.brain.ammoReadyAfter + 1);
  assert.equal(h.brain.metrics.attacks, 2);
});

test('hurt bots retreat and counterfire, retaining retreat until sufficiently healed', (t) => {
  const h = setup(t, ['ninja', 'wizard']);
  h.brain.random = () => 0.5;
  h.place(h.players[1], h.p.x + 110);
  h.p.health = h.p.maxHealth * 0.2;
  h.think();
  assert.equal(h.brain.decision.mode, 'retreat');
  assert.ok(h.brain.metrics.attacks > 0, 'can shoot while escaping');
  h.p.health = h.p.maxHealth * 0.45;
  h.think();
  assert.equal(h.brain.retreating, true);
  h.p.health = h.p.maxHealth * 0.8;
  h.think();
  assert.equal(h.brain.retreating, false);
});

test('low-health retreat creates meaningful distance from a nearby enemy', (t) => {
  const h = setup(t, ['ninja', 'wizard']);
  h.brain.openingDelay = 0;
  h.brain.openingUntil = 0;
  h.brain.random = () => 0.5;
  const enemy = h.players[1];
  h.place(enemy, h.p.x + 120);
  h.p.health = h.p.maxHealth * 0.25;
  const initialDistance = Math.abs(enemy.x - h.p.x);
  h.advance(150);
  assert.equal(h.brain.retreating, true);
  assert.ok(Math.abs(enemy.x - h.p.x) > initialDistance + 100);
  assert.equal(h.brain.decision.mode, 'retreat');
});

test('bots detour to useful healing beyond immediate pickup range and collect it', (t) => {
  const h = setup(t);
  h.brain.random = () => 0.5;
  h.brain.openingDelay = 0;
  h.p.health = h.p.maxHealth * 0.3;
  h.place(h.players[1], h.p.x + 400);
  h.room._powerups.set(7, { id: 7, type: 'health', x: h.p.x - 240, y: h.p.y, activeAt: h.now(), expiresAt: h.now() + 10000 });
  h.think();
  assert.equal(h.brain.decision.mode, 'pickup');
  assert.equal(h.brain.decision.pickupId, 7);
  h.advance(150, true);
  assert.equal(h.room._powerups.has(7), false);
  assert.equal(h.p.health, h.p.maxHealth);
});

test('a reachable weakened opponent can replace a healthy current target', (t) => {
  const h = setup(t, ['wizard', 'ninja', 'ninja']);
  const [p, healthy, weak] = h.players;
  weak.team = 'team2';
  h.place(healthy, p.x + 220);
  h.place(weak, p.x + 380);
  weak.health = weak.maxHealth * 0.1;
  h.brain.targetId = healthy.participantId;
  h.think();
  assert.equal(h.brain.targetId, weak.participantId);
  assert.equal(h.brain.metrics.targetSwitches, 1);
});

test('a healthier bot closes distance instead of kiting a wounded target', (t) => {
  const h = setup(t, ['ninja', 'wizard']);
  h.brain.openingDelay = 0;
  h.brain.openingUntil = 0;
  h.brain.kiteUntil = h.now() + 10000;
  h.brain.random = () => 0.5;
  const target = h.players[1];
  h.place(target, h.p.x + 500);
  target.health = target.maxHealth * 0.25;
  const initialDistance = Math.abs(target.x - h.p.x);
  h.think();
  assert.equal(h.brain.decision.mode, 'fight');
  assert.ok(Math.abs(target.x - h.brain.decision.goal.x) < initialDistance);
  h.advance(60);
  assert.ok(Math.abs(target.x - h.p.x) < initialDistance);
});

test('perception distinguishes approaching, departing, friendly, and curved projectiles', (t) => {
  const h = setup(t), enemy = h.players[1], body = bounds(h.p);
  const shot = { attackerParticipantId: enemy.participantId, x: h.p.x + 280, y: h.p.y + body.offsetY, vx: -600, vy: 0 };
  h.room._activeAttacks = [shot];
  assert.ok(incomingThreat(h.snapshot(), h.p, h.now()));
  shot.vx = 600;
  assert.equal(incomingThreat(h.snapshot(), h.p, h.now()), null);
  shot.attackerParticipantId = h.p.participantId;
  assert.equal(h.snapshot().projectiles.length, 0);
  shot.attackerParticipantId = enemy.participantId;
  delete shot.vx; delete shot.vy;
  h.brain.projectileSamples.set(shot, { x: shot.x + 60, y: shot.y, at: h.now() - 100 });
  assert.equal(h.snapshot().projectiles[0].vx, -600);
});

for (const trophies of [0, 2000]) {
  test(`a ${trophies}-trophy bot can choose a safe dodge for an incoming ranged attack`, (t) => {
    const h = setup(t, ['ninja', 'wizard'], trophies), enemy = h.players[1];
    h.brain.random = () => 0.2;
    h.room._activeAttacks = [{ attackerParticipantId: enemy.participantId,
      x: h.p.x + 240, y: h.p.y + bounds(h.p).offsetY, vx: -450, vy: 0, collisionRadius: 12 }];
    const observed = h.snapshot();
    assert.ok(incomingThreat(observed, h.p, h.now()));
    assert.equal(h.brain.tryDodge(observed, {}, h.now(), Infinity), true);
    assert.equal(h.brain.metrics.dodges, 1);
    assert.equal(h.brain.maneuver.end.grounded, true, 'dodge has a verified landing');
  });
}

test('aim anticipates a moving target more strongly at higher trophies', (t) => {
  const h = setup(t), target = { ...h.players[1], y: h.p.y + 70, vx: 200, vy: 120 };
  const noLead = basicAim(h.p, { ...target, vx: 0, vy: 0 }, difficultyForTrophies(2000), () => 0.5);
  const easy = basicAim(h.p, target, difficultyForTrophies(0), () => 0.5);
  const hard = basicAim(h.p, target, difficultyForTrophies(2000), () => 0.5);
  assert.ok(hard.target.x > easy.target.x);
  assert.ok(hard.target.y > noLead.target.y);
});

test('high-trophy profiles react, dodge, and commit attacks more reliably', () => {
  const easy = difficultyForTrophies(0), hard = difficultyForTrophies(2000);
  assert.ok(hard.reactionMaxMs < easy.reactionMinMs);
  assert.ok(hard.aimError < easy.aimError);
  assert.ok(hard.mistakeChance < easy.mistakeChance);
  assert.ok(hard.dodgeChance > easy.dodgeChance);
  assert.ok(hard.tacticalAwareness > easy.tacticalAwareness);
});

test('each character saves a charged super, threatens at its useful range, then uses a good opening', () => {
  const now = 1000000;
  for (const character of ['ninja', 'thorg', 'draven', 'wizard', 'huntress', 'gloop']) {
    const player = { participantId: 'bot', char_class: character, team: 'team1', x: 500, y: 400,
      vx: 0, vy: 0, grounded: true, isAlive: true, loaded: true, connected: true,
      health: 1000, maxHealth: 1000, superCharge: 100, maxSuperCharge: 100 };
    const target = { participantId: 'enemy', char_class: 'ninja', team: 'team2', x: 850, y: 400,
      vx: 100, vy: 0, grounded: true, health: 400, maxHealth: 1000 };
    if (character === 'thorg' || character === 'draven') target.x = 650;
    if (character === 'wizard') player.health = 500;
    const brain = { player, profile: difficultyForTrophies(1500), retreating: false,
      room: { players: new Map([['bot', player], ['enemy', target]]) }, metrics: { superSaves: 0 }, between: () => 800 };
    const plan = updateSuperPlan(brain, [target], now);
    assert.equal(plan.holding, true, `${character} reserves its super`);
    assert.equal(plan.preferredRange, SUPER_RANGES[character], `${character} advertises its threat range`);
    assert.equal(shouldUseSuper(brain, target, [target], now), false, `${character} does not spend immediately`);
    brain.superHoldUntil = now;
    brain.superPlan.holding = false;
    assert.equal(shouldUseSuper(brain, target, [target], now + 900), true, `${character} recognizes a good use`);
  }
});

test('supers remain saved when their character-specific condition is poor', () => {
  const now = 1000000;
  const player = { participantId: 'bot', char_class: 'draven', team: 'team1', x: 500, y: 400,
    health: 1000, maxHealth: 1000, superCharge: 100, maxSuperCharge: 100 };
  const distant = { participantId: 'enemy', team: 'team2', x: 1100, y: 200,
    vx: 200, vy: -200, grounded: false, health: 1000, maxHealth: 1000 };
  const brain = { player, profile: difficultyForTrophies(1500), retreating: false,
    room: { players: new Map([['bot', player], ['enemy', distant]]) }, metrics: { superSaves: 0 }, between: () => 0 };
  updateSuperPlan(brain, [distant], now);
  brain.superPlan.holding = false;
  assert.equal(shouldUseSuper(brain, distant, [distant], now + 5000), false);
  brain.retreating = true;
  distant.x = 650;
  assert.equal(shouldUseSuper(brain, distant, [distant], now + 5000), false, 'retreat remains the priority');
});

test('human Huntress projectiles are visible to bots without applying duplicate server damage', (t) => {
  const h = setup(t, ['huntress', 'ninja']), [human, bot] = h.players;
  human.isBot = false;
  let hits = 0;
  t.mock.method(h.room, 'handleHit', () => { hits++; });
  const action = { type: 'huntress-arrow-release', id: 'human-shot', x: human.x, y: human.y, direction: 1, angle: 0 };
  assert.equal(registerAttackFromAction(h.room, human, action, h.now()), false);
  assert.ok(h.room._botVisualProjectiles.length > 0);
  const count = h.room._botVisualProjectiles.length;
  registerAttackFromAction(h.room, human, action, h.now());
  assert.equal(h.room._botVisualProjectiles.length, count);
  assert.ok(observe(h.room, bot, h.now(), new WeakMap()).projectiles.length > 0);
  for (let i = 0; i < 200; i++) tickActiveAttacks(h.room, h.now() + i * 17);
  assert.equal(hits, 0);
  assert.equal(h.room._botVisualProjectiles.length, 0);
});

test('an unreachable target cannot leave a bot waiting forever with zero movement intent', (t) => {
  const h = setup(t, ['thorg', 'ninja']);
  const collision = { up: true, down: true, left: true, right: true };
  const ground = { id: 'ground', x: 1000, left: 100, right: 1900, top: 900, bottom: 940, collision };
  const ledge = { id: 'ledge', x: 1000, left: 900, right: 1100, top: 100, bottom: 130, collision };
  h.room.geometry = { ...h.room.geometry, mapId: 991, colliders: [ground, ledge] };
  Object.assign(h.p, standOn(ground, 'thorg', 700));
  Object.assign(h.players[1], standOn(ledge, 'ninja', 1000));
  h.brain.openingDelay = 0;
  h.brain.nextIdleAt = Infinity;
  h.advance(360);
  const x = h.p.x;
  let maxDisplacement = 0;
  for (let i = 0; i < 180; i++) {
    h.advance(1);
    maxDisplacement = Math.max(maxDisplacement, Math.abs(h.p.x - x));
  }
  assert.ok(h.brain.metrics.recoveries > 0);
  assert.ok(maxDisplacement > 35, 'searches another position even without a complete route');
  assert.equal(h.brain.metrics.unforcedFalls, 0);
});
