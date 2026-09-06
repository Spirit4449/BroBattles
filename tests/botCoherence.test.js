const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const { getDuelGeometry } = require('../src/shared/duelGeometry');
const { buildGraph, findRoute, standOn, safeWalkDirection, walkLimits, canStandAt } = require('../src/server/core/bots/navigation');
const { stepBody } = require('../src/server/core/bots/physics');
const { difficultyForTrophies } = require('../src/server/core/bots/config');
const { createBotParticipants, BOT_NAMES } = require('../src/server/core/bots/identity');
const { chooseDecision, preferredRange } = require('../src/server/core/bots/tactics');
const { observe } = require('../src/server/core/bots/perception');
const effects = require('../src/server/core/gameRoom/effects/effectManager');
const characters = ['ninja', 'thorg', 'draven', 'wizard', 'huntress', 'gloop'];

function clock(t) {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'log', () => {});
  return { now: () => now, step: (h) => { now += 1000 / 60; h.tick(now); } };
}

// Exercise the real executor, not just replay of idealized graph samples. Low
// trophy bots must be able to reach every ordinary Duel platform independently
// of aim, reactions, combat damage and optional tactical movement.
for (const map of [1, 2, 3]) for (const character of characters) {
  test(`${character} at zero trophies executes every map ${map} destination safely`, (t) => {
    const time = clock(t);
    const destinations = buildGraph(getDuelGeometry(map), character).surfaces.filter((s) => s.id !== 'p0');
    for (const destination of destinations) {
      const h = makeRoom({ map, characters: [character, 'ninja'], trophies: 0, seed: 17 });
      try {
        const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
        h.players[1].isAlive = false;
        h.place(p, map === 2 ? 980 : 1150);
        brain.retreating = false;
        brain.openingUntil = 0;
        brain.nextDecisionAt = Infinity;
        brain.decision = { mode: 'reposition', goal: { x: destination.x, y: destination.top, surfaceId: destination.id } };
        let arrived = false;
        for (let i = 0; i < 1800 && p.isAlive; i++) {
          time.step(h);
          if (p.grounded && p.platformId === destination.id && !brain.traversal && !brain.maneuver && Math.abs(p.vx) < 12) { arrived = true; break; }
        }
        assert.ok(arrived, `failed to reach ${destination.id}`);
        assert.equal(brain.metrics.unforcedFalls, 0);
      } finally { h.room.cleanup(); }
    }
  });
}

test('a held position at a narrow ledge settles instead of alternating directions', () => {
  const geometry = getDuelGeometry(1);
  const surface = geometry.colliders.find((s) => s.id === 'p2');
  for (const character of characters) {
    const limits = walkLimits(surface, character);
    const p = standOn(surface, character, limits.right);
    let movement = 0;
    for (let i = 0; i < 240; i++) {
      const direction = safeWalkDirection(p, 0, geometry);
      movement += Math.abs(direction);
      p.flip = direction < 0;
      assert.equal(stepBody(p, { direction }, geometry, 1000 / 60, i * 1000 / 60).fell, false);
    }
    assert.equal(movement, 0, `${character} keeps its safe hold`);
    assert.equal(p.platformId, surface.id);
  }
});

test('route planning accounts for walking to takeoff and both sides of a solid block', () => {
  const graph = buildGraph(getDuelGeometry(2), 'thorg');
  const route = findRoute(graph, 'p0', 'p3', Infinity, { startX: 980 });
  assert.ok(route?.length > 1, 'uses intermediate ground instead of walking through the central block');
  assert.ok(route.some((edge) => edge.to === 'p1'), 'climbs the central block');
  for (const [from, edges] of graph.edges) {
    const surface = graph.surfaces.find((s) => s.id === from);
    for (const edge of edges) assert.ok(canStandAt(graph.geometry, surface, graph.character, edge.takeoffX));
  }
});

test('tactical commitment withstands small target movements but yields to close pressure', (t) => {
  const time = clock(t), h = makeRoom({ characters: ['wizard', 'thorg'], trophies: 4000 });
  t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  const floor = { id: 'floor', x: 1250, left: 0, right: 2500, top: 800, bottom: 850,
    collision: { up: true, down: true, left: true, right: true } };
  h.room.geometry = { ...h.room.geometry, colliders: [floor] };
  h.place(p, 700, floor); h.place(enemy, 1150, floor);
  brain.spacing = 1; brain.aggression = 1; brain.retreating = false;
  const context = brain.context({}, time.now());
  brain.decision = chooseDecision(brain, context, enemy, [enemy], time.now());
  const original = brain.decision.goal;
  for (const dx of [8, -8, 12, -12, 5, -5]) {
    enemy.x = 1150 + dx;
    brain.decision = chooseDecision(brain, context, enemy, [enemy], time.now());
    assert.deepEqual(brain.decision.goal, original);
  }
  enemy.x = p.x + 100;
  const changed = chooseDecision(brain, context, enemy, [enemy], time.now());
  assert.equal(changed.mode, 'kite');
  assert.ok(Math.abs(changed.goal.x - enemy.x) > Math.abs(p.x - enemy.x) + 150);
});

test('Wizard walks away from close pressure while retaining the ability to counterattack', (t) => {
  const time = clock(t), h = makeRoom({ characters: ['wizard', 'thorg'], trophies: 4000 });
  t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  h.room.botControllers.delete(enemy.participantId);
  h.place(p, 1200); h.place(enemy, 1320);
  enemy.health = enemy.maxHealth = 1000000;
  brain.openingUntil = 0; brain.random = () => 0.5;
  let maxSpacing = 0;
  for (let i = 0; i < 180; i++) { time.step(h); maxSpacing = Math.max(maxSpacing, Math.hypot(p.x - enemy.x, p.y - enemy.y)); }
  assert.ok(maxSpacing > 260, 'actively creates space');
  assert.ok(brain.metrics.attacks > 0, 'movement and attacks cooperate');
  assert.equal(brain.metrics.unforcedFalls, 0);
});

test('injury interrupts a long movement commitment immediately', (t) => {
  const time = clock(t), h = makeRoom({ characters: ['wizard', 'ninja'] });
  t.after(() => h.room.cleanup());
  const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
  h.place(p, 1100); h.place(h.players[1], 1300);
  brain.openingUntil = 0; brain.retreating = false;
  const snapshot = () => observe(h.room, p, time.now(), brain.projectileSamples);
  brain.think(snapshot(), {}, time.now());
  brain.nextDecisionAt = time.now() + 100000;
  p.health = p.maxHealth * 0.2;
  brain.think(snapshot(), effects.getModifiers(p, time.now()), time.now());
  assert.equal(brain.decision.mode, 'retreat');
});

test('trophy skills keep improving through 4000 and stay bounded above it', () => {
  const tiers = [0, 500, 1250, 2000, 3000, 4000].map(difficultyForTrophies);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i].reactionMinMs < tiers[i - 1].reactionMinMs);
    assert.ok(tiers[i].aimError < tiers[i - 1].aimError);
    assert.ok(tiers[i].tacticalAwareness > tiers[i - 1].tacticalAwareness);
    assert.ok(tiers[i].dodgeChance > tiers[i - 1].dodgeChance);
    assert.ok(tiers[i].mistakeChance < tiers[i - 1].mistakeChance);
  }
  assert.deepEqual(difficultyForTrophies(4000), difficultyForTrophies(90000));
  assert.ok(tiers.at(-1).reactionMinMs >= 100);
  assert.ok(tiers.at(-1).aimError > 0 && tiers.at(-1).dodgeChance < 1);
});

test('legacy BOT number and BOT ULTRA names cannot reenter through database name sampling', () => {
  const forbidden = ['BOT 123456', 'BOT123', 'BOT ULTRA', 'bot_ultra', ' Bot-987 '];
  const humans = [{ name: 'Human', team: 'team1', level: 1, trophies: 1000 }];
  for (let seed = 0; seed < 150; seed++) {
    const bots = createBotParticipants(humans, 3, { seed, realNames: [...forbidden, 'ActualPlayer'] });
    assert.ok(bots.every((b) => !forbidden.includes(b.name)));
    assert.equal(new Set(bots.map((b) => b.name.toLowerCase())).size, bots.length);
  }
  assert.ok(BOT_NAMES.length > 4000);
});

test('allied bots yield an ordinary pickup to the teammate already collecting it', (t) => {
  const time = clock(t), h = makeRoom({ characters: ['wizard', 'ninja', 'wizard', 'ninja'], trophies: 4000 });
  t.after(() => h.room.cleanup());
  const [p, enemy, ally] = h.players, brain = h.room.botControllers.get(p.participantId);
  h.place(p, 1050); h.place(ally, 1080); h.place(enemy, 1450);
  const pickup = { id: 42, type: 'shield', x: 1200, y: p.y, activeAt: time.now(), expiresAt: time.now() + 10000 };
  h.room._powerups.set(pickup.id, pickup);
  const other = h.room.botControllers.get(ally.participantId);
  other.decision = { mode: 'pickup', pickupId: 42, goal: pickup };
  const context = brain.context({}, time.now());
  const decision = chooseDecision(brain, context, enemy, [enemy], time.now());
  assert.notEqual(decision.pickupId, 42);
  // Emergency healing is allowed to supersede ordinary team ownership.
  pickup.type = 'health'; p.health = p.maxHealth * 0.15;
  brain.retreating = true;
  assert.equal(chooseDecision(brain, context, enemy, [enemy], time.now()).pickupId, 42);
});

test('Wizard can use a defensive team buff during recovery without abandoning retreat', (t) => {
  const time = clock(t), h = makeRoom({ characters: ['wizard', 'ninja'], trophies: 4000 });
  t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  h.place(p, 1000); h.place(enemy, 1500);
  p.health = p.maxHealth * 0.15;
  p.superCharge = p.maxSuperCharge;
  brain.retreating = true;
  const { updateSuperPlan } = require('../src/server/core/bots/supers');
  updateSuperPlan(brain, [enemy], time.now());
  brain.superHoldUntil = time.now();
  updateSuperPlan(brain, [enemy], time.now());
  brain.tryCombat([enemy], enemy, { at: time.now() }, time.now());
  assert.equal(brain.metrics.specials, 1);
  assert.equal(brain.retreating, true);
});

for (const character of ['thorg', 'wizard']) test(`${character} actually collects a high Lushy pickup instead of holding just outside its radius`, (t) => {
  const time = clock(t), h = makeRoom({ characters: [character, 'ninja'], trophies: 4000 });
  t.after(() => h.room.cleanup());
  const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
  h.players[1].isAlive = false;
  const upper = h.room.geometry.colliders.find((s) => s.id === 'p1');
  h.place(p, 1100, upper);
  p.health = p.maxHealth * 0.2;
  brain.openingUntil = 0;
  h.room._lastPowerupSpawnAt = time.now();
  h.room._powerups.set(50, { id: 50, type: 'health', x: 1150, y: 125.15, activeAt: time.now(), expiresAt: time.now() + 15000 });
  for (let i = 0; i < 300 && h.room._powerups.has(50); i++) { time.step(h); h.room._tickPowerups(); }
  assert.equal(h.room._powerups.has(50), false);
  assert.equal(p.health, p.maxHealth);
  assert.equal(brain.metrics.unforcedFalls, 0);
});

test('tactics and recovery require a route to the actual point, not merely its platform', (t) => {
  const time = clock(t), h = makeRoom({ map: 2, characters: ['ninja', 'thorg'], trophies: 4000 });
  t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  const surface = h.room.geometry.colliders.find((s) => s.id === 'p2');
  h.place(p, 735, surface);
  h.place(enemy, 1450, h.room.geometry.colliders.find((s) => s.id === 'p5'));
  brain.retreating = false; brain.openingUntil = 0;
  const context = brain.context({}, time.now());
  brain.decision = { mode: 'fight', goal: { x: 1150, y: 634.8, surfaceId: 'p0' } };
  const decision = chooseDecision(brain, context, enemy, [enemy], time.now());
  assert.notEqual(context.routeTo(decision.goal.surfaceId, decision.goal.x), null);
  brain.wantsProgress = true;
  brain.lastPosition = { x: p.x, y: p.y };
  brain.lastProgressAt = time.now() - 3000;
  brain.checkProgress(time.now(), 1000 / 60, {});
  const goal = brain.decision.goal;
  assert.ok(goal);
  assert.ok(canStandAt(h.room.geometry, brain.graph.surfaces.find((s) => s.id === goal.surfaceId), p.char_class, goal.x));
  assert.notEqual(context.routeTo(goal.surfaceId, goal.x), null);
});

test('unreachable loot and an obstructed last-seen point cannot replace a valid exploration goal', (t) => {
  const time = clock(t), h = makeRoom({ map: 2, characters: ['thorg', 'ninja'] });
  t.after(() => h.room.cleanup());
  const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
  h.place(p, 980);
  brain.lastSeen = { ...h.players[1], x: 1150, y: p.y, platformId: 'p0', grounded: true, at: time.now() };
  h.room._deathDrops.set(90, { id: 90, type: 'coin', x: 1150, y: p.y, claimedBy: null, expiresAt: time.now() + 15000 });
  const context = brain.context({}, time.now());
  const decision = chooseDecision(brain, context, null, [], time.now());
  assert.notEqual(decision.mode, 'loot');
  assert.notEqual(decision.mode, 'search');
  assert.ok(decision.goal);
  assert.notEqual(context.routeTo(decision.goal.surfaceId, decision.goal.x), null);
});

test('a dying bot avoids crossing its pursuer even when the far side offers more space or healing', (t) => {
  const time = clock(t), h = makeRoom({ characters: ['wizard', 'ninja'], trophies: 4000 });
  t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  const floor = { id: 'escape-floor', x: 1200, left: 0, right: 2400, top: 800, bottom: 850,
    collision: { up: true, down: true, left: true, right: true } };
  h.room.geometry = { ...h.room.geometry, colliders: [floor] };
  h.place(p, 600, floor); h.place(enemy, 800, floor);
  p.health = p.maxHealth * 0.15; brain.retreating = true;
  const context = brain.context({}, time.now());
  brain.decision = chooseDecision(brain, context, enemy, [enemy], time.now());
  assert.equal(brain.decision.mode, 'retreat');
  assert.ok(brain.decision.goal.x < p.x, 'escapes on its current side of the pursuer');
  h.room._powerups.set(99, { id: 99, type: 'health', x: 1000, y: p.y, activeAt: time.now(), expiresAt: time.now() + 10000 });
  for (const x of [780, 740, 700]) {
    enemy.x = x;
    brain.decision = chooseDecision(brain, context, enemy, [enemy], time.now());
    assert.equal(brain.decision.mode, 'retreat', 'does not run through the enemy for healing');
    assert.ok(brain.decision.goal.x < p.x);
  }
});

test('a pursued bot fires repeated counterattacks while continuing to escape', (t) => {
  const time = clock(t), h = makeRoom({ characters: ['ninja', 'wizard'], trophies: 4000 });
  t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  h.room.botControllers.delete(enemy.participantId);
  const floor = { id: 'chase-floor', x: 1500, left: 0, right: 3000, top: 800, bottom: 850,
    collision: { up: true, down: true, left: true, right: true } };
  h.room.geometry = { ...h.room.geometry, colliders: [floor] };
  h.place(p, 1800, floor); h.place(enemy, 2000, floor);
  p.health = p.maxHealth * 0.2;
  enemy.health = enemy.maxHealth = 1000000;
  brain.openingUntil = 0; brain.random = () => 0.5;
  for (let i = 0; i < 240; i++) {
    h.place(enemy, p.x + 200, floor);
    time.step(h);
  }
  assert.ok(p.x < 1500, 'continues escaping while firing');
  assert.ok(brain.metrics.attacks >= 4, `only fired ${brain.metrics.attacks} counterattacks`);
  assert.equal(brain.metrics.unforcedFalls, 0);
  h.place(enemy, p.x + 1100, floor);
  const attacks = brain.metrics.attacks;
  for (let i = 0; i < 90; i++) time.step(h);
  assert.equal(brain.metrics.attacks, attacks, 'stops firing once pressure is gone');
});

for (const map of [1, 2, 3]) for (const character of characters) {
  test(`${character} completes a sudden-death escape on map ${map} without resetting its takeoff`, (t) => {
    const time = clock(t);
    const h = makeRoom({ map, characters: [character, 'ninja'], trophies: 0, seed: 17 });
    try {
      const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
      h.players[1].isAlive = false;
      h.place(p, map === 2 ? 980 : 1150);
      const startY = p.y;
      h.room._suddenDeathActive = true;
      h.room._loopStartWallTime = time.now() - h.room.gameMode.getMatchDurationMs();
      // All low landings and takeoff approaches are exposed. The bot must
      // still execute physically valid motion rather than cancelling each think.
      h.room._computePoisonY = () => startY - 5;
      let escaped = false;
      for (let i = 0; i < 900 && p.isAlive; i++) {
        time.step(h);
        if (p.grounded && p.y < startY - 150) { escaped = true; break; }
      }
      assert.ok(escaped, `stalled at ${p.x},${p.y} (${brain.decision?.mode})`);
      assert.equal(brain.metrics.unforcedFalls, 0);
    } finally { h.room.cleanup(); }
  });
}

test('poison exposure uses player origin, travel time and the future rising level', () => {
  const { poisonDamage } = require('../src/server/core/bots/navigation');
  assert.equal(poisonDamage([{ y: 899 }], 1000, 900), 0);
  assert.equal(poisonDamage([{ y: 900 }], 1000, 900), 400);
  assert.equal(poisonDamage([{ y: 890 }, { y: 890 }], 1000, 900, (ms) => 900 - ms * 0.04), 200);
});

test('routing prefers a dry detour but retains a submerged stepping stone when necessary', () => {
  const low = { id: 'low', top: 920 }, wet = { id: 'wet', top: 950 }, high = { id: 'high', top: 600 };
  const edge = (to, y, duration) => ({ to, takeoffX: 0, landingX: 0, duration, frames: [{ x: 0, y }] });
  const submerged = edge('wet', 910, 400), climb = edge('high', 850, 400), dry = edge('high', 700, 1200);
  const graph = { surfaces: [low, wet, high], body: { offsetY: 0, halfHeight: 20 }, edges: new Map([
    ['low', [submerged, dry]], ['wet', [climb]], ['high', []],
  ]) };
  assert.deepEqual(findRoute(graph, 'low', 'high', 900), [dry]);
  graph.edges.set('low', [submerged]);
  assert.deepEqual(findRoute(graph, 'low', 'high', 900), [submerged, climb]);
});

test('sudden-death tactics trade a hazardous retreat against a charging opponent and remaining health', (t) => {
  const time = clock(t), h = makeRoom({ characters: ['wizard', 'ninja'], trophies: 4000 });
  t.after(() => h.room.cleanup());
  const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
  const shelf = { id: 'shelf', x: 600, left: 520, right: 680, top: 600, bottom: 620, collision: { up: true } };
  const floor = { id: 'floor', x: 1000, left: 0, right: 2000, top: 720, bottom: 740, collision: { up: true } };
  h.room.geometry = { ...h.room.geometry, colliders: [shelf, floor] };
  h.place(p, 600, shelf); h.place(enemy, 650, shelf);
  enemy.vx = -300;
  const graph = buildGraph(h.room.geometry, p.char_class);
  const context = { graph, current: shelf, poisonY: 610, poisonAt: () => 610,
    routeTo: (id, x) => findRoute(graph, shelf.id, id, 610, { startX: p.x, goalX: x }) };
  brain.retreating = false;
  const escape = chooseDecision(brain, context, enemy, [enemy], time.now());
  assert.equal(escape.goal.surfaceId, floor.id, 'accepts poison to escape close pressure on the narrow shelf');
  p.health = 30;
  const desperate = chooseDecision(brain, context, enemy, [enemy], time.now());
  assert.equal(desperate.goal.surfaceId, shelf.id, 'does not prefer a predictably lethal poison detour');
  p.health = p.maxHealth;
  enemy.x = 1700; enemy.vx = 0;
  const safe = chooseDecision(brain, context, enemy, [enemy], time.now());
  assert.equal(safe.goal.surfaceId, shelf.id, 'keeps dry ground when the opponent is not pressuring it');
});

for (const character of characters) {
  test(`${character} keeps pursuing distant opponents when sudden death begins`, (t) => {
    const time = clock(t), h = makeRoom({ characters: [character, 'ninja'], trophies: 2000 });
    t.after(() => h.room.cleanup());
    const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
    const floor = { id: 'dry-floor', x: 1500, left: 0, right: 3000, top: 600, bottom: 650,
      collision: { up: true, down: true, left: true, right: true } };
    h.room.geometry = { ...h.room.geometry, colliders: [floor] };
    h.place(p, 700, floor); h.place(enemy, 1900, floor);
    h.room.botControllers.delete(enemy.participantId);
    h.room._suddenDeathActive = true;
    h.room._loopStartWallTime = time.now() - h.room.gameMode.getMatchDurationMs();
    brain.random = () => 0.5;
    const context = brain.context({}, time.now());
    const normal = chooseDecision(brain, { ...context, poisonY: Infinity, poisonAt: () => Infinity }, enemy, [enemy], time.now());
    const sudden = chooseDecision(brain, context, enemy, [enemy], time.now());
    assert.deepEqual(sudden, normal, 'distant gas does not replace normal combat positioning');
    for (let i = 0; i < 180; i++) time.step(h);
    assert.ok(p.x > 1000, `fails to close distance: ${p.x}`);
    assert.notEqual(brain.decision.mode, 'escape');
  });
}

for (const map of [1, 2, 3]) {
  test(`map ${map} restores normal routes at exactly 90 percent gas coverage`, (t) => {
    const time = clock(t), h = makeRoom({ map });
    t.after(() => h.room.cleanup());
    const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
    h.place(p, map === 2 ? 980 : 1150);
    const normal = brain.context({}, time.now());
    h.room._suddenDeathActive = true;
    let level = 101;
    h.room._computePoisonY = () => level;
    assert.equal(brain.context({}, time.now()).gasSaturated, false);
    for (level of [100, 99, 0]) {
      const saturated = brain.context({}, time.now());
      assert.equal(saturated.gasSaturated, true);
      assert.equal(saturated.poisonY, Infinity);
      assert.equal(saturated.poisonAt(2000), Infinity);
      for (const surface of normal.graph.surfaces) {
        assert.deepEqual(saturated.routeTo(surface.id, surface.x), normal.routeTo(surface.id, surface.x));
      }
      assert.deepEqual(chooseDecision(brain, saturated, h.players[1], [h.players[1]], time.now()),
        chooseDecision(brain, normal, h.players[1], [h.players[1]], time.now()));
    }
    brain.suddenDeathActive = true;
    brain.gasSaturated = false;
    brain.decision = { mode: 'escape', goal: null };
    brain.nextDecisionAt = Infinity;
    brain.idleUntil = time.now() + 10000;
    brain.think(observe(h.room, p, time.now(), brain.projectileSamples), effects.getModifiers(p, time.now()), time.now());
    assert.notEqual(brain.decision.mode, 'escape', 'threshold discards a stale escape decision immediately');
    assert.ok(brain.idleUntil < time.now() + 1000, 'clears the stale idle timer while allowing ordinary arrival pauses');
  });
}
