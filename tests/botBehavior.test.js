const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Bot behavior and routes", () => {
  const { makeBotBehaviorRoom: setup } = require('./helpers/botRoom');
  const { bounds } = require('../src/server/core/physics/bodySolver');
  const { standOn } = require('../src/server/core/bots/navigation');
  const { observe, incomingThreat } = require('../src/server/core/bots/perception');
  const { preferredRange } = require('../src/server/core/bots/tactics');
  const { basicAim, hasClearShot, requestBasic } = require('../src/shared/combat/combat.js');
  const { botProfile } = require('../src/shared/combat/characterProfiles.js');
  // A real basic attack from `enemy` aimed level with the bot at `x`.
  // Sparrow's arrows fly straight enough for a hop to clear them.
  const enemyFires = (h, enemy, x) => {
    // Only the bot under test has a controller to reload, so ready the shot.
    Object.assign(enemy, { connected: true, loaded: true, flip: x < enemy.x });
    Object.assign(enemy.ammoState, { charges: enemy.ammoState.capacity, nextFireInMs: 0 });
    assert.ok(requestBasic(h.room, enemy, { ...h.p, x, y: h.p.y }, botProfile(enemy.char_class), () => 0.5, h.now()));
  };
  const { SUPER_RANGES, updateSuperPlan, shouldUseSuper } = require('../src/server/core/bots/supers');
  const { difficultyForTrophies } = require('../src/server/core/bots/config');
  const { registerAttackFromAction, tickActiveAttacks } = require('../src/shared/combat/runtime/attackRuntimeManager.js');
  const effects = require('../src/shared/combat/runtime/effects/effectManager.js');

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
    const h = setup(t, ['ninja', 'ozzy']);
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

  test('sparrow leaves a longer punish window between arrow spreads', (t) => {
    const h = setup(t, ['sparrow', 'ninja']);
    h.brain.random = () => 0.5;
    const hesitation = h.brain.attackHesitationMs();
    assert.ok(hesitation >= 360, `hesitation was ${hesitation}ms`);
    assert.ok(hesitation > h.p.ammoState.cooldownMs);
  });

  test('sudden death preserves combat positioning while the gas is distant', (t) => {
    const h = setup(t, ['ninja', 'ozzy']);
    const currentTop = h.room.geometry.colliders.find((surface) => surface.id === h.p.platformId).top;
    h.brain.openingUntil = h.now() + 10000;
    h.brain.decision = { mode: 'fight', goal: { x: h.p.x, y: currentTop, surfaceId: h.p.platformId } };
    h.room.suddenDeathActive = true;
    h.room.loopStartWallTime = h.now() - h.room.gameMode.getMatchDurationMs();
    h.think();
    assert.equal(h.brain.decision.mode, 'fight');
    assert.ok(h.brain.decision.goal, 'retains an actionable combat destination');
    assert.equal(h.brain.openingUntil, 0, 'opening pause cannot suppress survival movement');
  });

  test('a bot already reached by poison can still take an upward escape route', () => {
    const { findRoute } = require('../src/server/core/bots/navigation');
    const low = { id: 'low', top: 920 };
    const high = { id: 'high', top: 650 };
    const climb = { to: high.id, duration: 600, frames: [
      { y: 900 }, { y: 890 }, { y: 840 }, { y: 760 }, { y: 680 },
    ] };
    const graph = {
      body: { offsetY: 0, halfHeight: 20 },
      surfaces: [low, high],
      edges: new Map([[low.id, [climb]], [high.id, []]]),
    };
    assert.deepEqual(findRoute(graph, low.id, high.id, 900), [climb]);

    const dive = { ...climb, frames: [{ y: 900 }, { y: 930 }, { y: 840 }] };
    graph.edges.set(low.id, [dive]);
    assert.deepEqual(findRoute(graph, low.id, high.id, 900), [dive], 'a hazardous crossing remains available when it is the only escape');
  });

  test('hurt bots retreat and counterfire, retaining retreat until sufficiently healed', (t) => {
    const h = setup(t, ['ninja', 'ozzy']);
    h.p._dashReadyAt = h.now() + 5000; // Exercise counterfire while dash is unavailable.
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
    const h = setup(t, ['ninja', 'ozzy']);
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
    h.room.powerups.set(7, { id: 7, type: 'health', x: h.p.x - 240, y: h.p.y, activeAt: h.now(), expiresAt: h.now() + 10000 });
    h.think();
    assert.equal(h.brain.decision.mode, 'pickup');
    assert.equal(h.brain.decision.pickupId, 7);
    h.advance(150, true);
    assert.equal(h.room.powerups.has(7), false);
    assert.equal(h.p.health, h.p.maxHealth);
  });

  test('bots contest a useful shockwave and focus the nearby rival while approaching it', (t) => {
    const h = setup(t), enemy = h.players[1];
    const floor = { id: 'shock-floor', x: 1000, left: 0, right: 2000, top: 700, bottom: 740,
      collision: { up: true, down: true, left: true, right: true } };
    h.room.geometry = { ...h.room.geometry, mapId: 9911, colliders: [floor] };
    h.place(h.p, 700, floor);
    h.place(enemy, 1050, floor);
    h.brain.openingUntil = 0;
    h.brain.random = () => 0.5;
    h.room.powerups.set(81, { id: 81, type: 'shockwave', x: 850, y: h.p.y,
      activeAt: h.now(), expiresAt: h.now() + 10000 });
    h.think();
    assert.equal(h.brain.decision.mode, 'pickup');
    assert.equal(h.brain.decision.pickupId, 81);
    assert.equal(h.brain.decision.contestTargetId, enemy.participantId);
    assert.ok(h.brain.metrics.attacks > 0, 'continues fighting the rival while contesting');
  });

  test('bots contest a useful ordinary powerup but ignore pickups that harm the collector', (t) => {
    const h = setup(t), enemy = h.players[1];
    const floor = { id: 'powerup-floor', x: 1250, left: 0, right: 2500, top: 700, bottom: 740,
      collision: { up: true, down: true, left: true, right: true } };
    h.room.geometry = { ...h.room.geometry, mapId: 9914, colliders: [floor] };
    h.place(h.p, 700, floor);
    h.place(enemy, 1000, floor);
    h.brain.openingUntil = 0;
    h.brain.random = () => 0.5;
    h.room.powerups.set(83, { id: 83, type: 'shield', x: 850, y: h.p.y,
      activeAt: h.now(), expiresAt: h.now() + 10000 });
    h.think();
    assert.equal(h.brain.decision.mode, 'pickup');
    assert.equal(h.brain.decision.contestTargetId, enemy.participantId);

    h.room.powerups.clear();
    h.place(enemy, 2400, floor);
    h.brain.decision = null;
    h.room.powerups.set(84, { id: 84, type: 'poison', x: 760, y: h.p.y,
      activeAt: h.now(), expiresAt: h.now() + 10000 });
    h.think();
    assert.notEqual(h.brain.decision.mode, 'pickup');
  });

  test('bots concede a shockwave race already won by an opponent and leave its blast area', (t) => {
    const h = setup(t), enemy = h.players[1];
    const floor = { id: 'escape-floor', x: 1000, left: 0, right: 2000, top: 700, bottom: 740,
      collision: { up: true, down: true, left: true, right: true } };
    h.room.geometry = { ...h.room.geometry, mapId: 9912, colliders: [floor] };
    h.place(h.p, 500, floor);
    h.place(enemy, 950, floor);
    h.brain.openingUntil = 0;
    h.brain.random = () => 0.5;
    const shockwave = { id: 82, type: 'shockwave', x: 1000, y: h.p.y,
      activeAt: h.now() + 500, expiresAt: h.now() + 10000 };
    h.room.powerups.set(shockwave.id, shockwave);
    h.think();
    assert.equal(h.brain.decision.mode, 'evade-powerup');
    assert.ok(Math.abs(h.brain.decision.goal.x - shockwave.x) > 420,
      'chooses ground outside the shockwave radius');
  });

  test('bots collect nearby death coins and gems through the authoritative reward path', (t) => {
    const h = setup(t);
    h.brain.openingUntil = 0;
    for (const [id, type, offset] of [[91, 'coin', 20], [92, 'gem', -20]]) {
      h.room.deathDrops.set(id, { id, type, value: 1, x: h.p.x + offset, y: h.p.y,
        spawnX: h.p.x + offset, spawnY: h.p.y, spawnedAt: h.now() - 500, expiresAt: h.now() + 10000,
        claimedBy: null });
    }
    h.think();
    assert.equal(h.room.deathDrops.size, 0);
    assert.equal(h.brain.metrics.lootCollected, 2);
    assert.deepEqual(h.events.filter((event) => event.type === 'deathdrop:collected').map((event) => event.payload.type).sort(), ['coin', 'gem']);
  });

  test('loose loot is an opportunistic goal, but only over a modest safe detour', (t) => {
    const h = setup(t), enemy = h.players[1];
    const floor = { id: 'loot-floor', x: 1250, left: 0, right: 2500, top: 700, bottom: 740,
      collision: { up: true, down: true, left: true, right: true } };
    h.room.geometry = { ...h.room.geometry, mapId: 9913, colliders: [floor] };
    h.place(h.p, 500, floor);
    h.place(enemy, 2400, floor);
    h.brain.openingUntil = 0;
    h.brain.random = () => 0.5;
    h.room.deathDrops.set(93, { id: 93, type: 'coin', value: 1, x: 735, y: h.p.y,
      spawnX: 735, spawnY: h.p.y, spawnedAt: h.now(), expiresAt: h.now() + 10000, claimedBy: null });
    h.think();
    assert.equal(h.brain.decision.mode, 'loot');
    assert.equal(h.brain.decision.dropId, 93);

    h.room.deathDrops.clear();
    h.brain.decision = null;
    h.room.deathDrops.set(94, { id: 94, type: 'coin', value: 1, x: 1200, y: h.p.y,
      spawnX: 1200, spawnY: h.p.y, spawnedAt: h.now(), expiresAt: h.now() + 10000, claimedBy: null });
    h.think();
    assert.notEqual(h.brain.decision.mode, 'loot', 'does not center play around a distant coin');
  });

  test('a reachable weakened opponent can replace a healthy current target', (t) => {
    const h = setup(t, ['ozzy', 'ninja', 'ninja']);
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
    const h = setup(t, ['ninja', 'ozzy']);
    h.brain.openingDelay = 0;
    h.brain.openingUntil = 0;
    h.brain.kiteUntil = h.now() + 10000;
    h.brain.random = () => 0.5;
    const target = h.players[1];
    h.place(target, h.p.x + 500);
    target.health = target.maxHealth * 0.25;
    const initialDistance = Math.abs(target.x - h.p.x);
    h.think();
    if (h.brain.metrics.dashChases) {
      assert.ok(Math.abs(target.x - h.brain.maneuver.end.x) < initialDistance);
    } else {
      assert.equal(h.brain.decision.mode, 'fight');
      assert.ok(Math.abs(target.x - h.brain.decision.goal.x) < initialDistance);
    }
    h.advance(60);
    assert.ok(Math.abs(target.x - h.p.x) < initialDistance);
  });

  test('pursuit crosses empty ground continuously and keeps useful fighting range', (t) => {
    const h = setup(t, ['ninja', 'ozzy']);
    const floor = { id: 'floor', x: 1100, left: 100, right: 2100, top: 900, bottom: 940,
      collision: { up: true, down: true, left: true, right: true } };
    h.room.geometry = { ...h.room.geometry, mapId: 992, colliders: [floor] };
    const enemy = h.players[1];
    h.place(h.p, 300, floor);
    h.place(enemy, 1700, floor);
    enemy.health = enemy.maxHealth = 1000000;
    h.brain.openingUntil = 0;
    h.brain.random = () => 0.5;
    let stoppedOutOfRange = 0;
    for (let i = 0; i < 600; i++) {
      h.advance(1);
      if (i > 60 && enemy.x - h.p.x > 700 && Math.abs(h.p.vx) < 12) stoppedOutOfRange++;
    }
    assert.equal(stoppedOutOfRange, 0, 'does not pause before it can pressure an opponent');
    assert.ok(h.p.x > 1000, 'makes sustained progress toward a distant target');
    assert.ok(enemy.x - h.p.x > 180, 'retains ranged fighting space');
    assert.ok(h.brain.metrics.attacks > 0);
    assert.equal(h.brain.metrics.unforcedFalls, 0);
    const previousX = h.p.x;
    h.place(enemy, 2000, floor);
    h.advance(180);
    assert.ok(h.p.x > previousX + 80, 'follows when the opponent gives up more ground');
  });

  test('ineffective pacing changes position, while successful pressure keeps its ground', (t) => {
    const h = setup(t), enemy = h.players[1];
    h.brain.random = () => 0.5;
    h.place(enemy, h.p.x + preferredRange(h.brain, enemy));
    h.think();
    const x = h.p.x, start = h.now();
    h.brain.trackCombatProgress(enemy, start);
    // Moving a little back and forth must not reset the tactical progress timer.
    for (let i = 1; i <= 6; i++) {
      h.p.x = x + (i % 2 ? 25 : 0);
      h.brain.trackCombatProgress(enemy, start + i * 1000);
    }
    assert.ok(h.brain.ineffectivePositions.length > 0);
    h.think();
    assert.ok(Math.abs(h.brain.decision.goal.x - x) > 80, 'seeks a different firing position after no progress');
    h.brain.ineffectivePositions.length = 0;
    h.brain.combatProgress = null;
    for (let i = 0; i <= 8; i++) {
      h.room.rewardStats.set(h.p.name, { damage: i * 100 });
      h.brain.trackCombatProgress(enemy, start + i * 1000);
    }
    assert.equal(h.brain.ineffectivePositions.length, 0, 'repeated successful attacks do not force arbitrary movement');
  });

  test('gloop positioning rejects ground whose firing line is blocked', (t) => {
    const h = setup(t, ['gloop', 'ninja']), enemy = h.players[1];
    const floor = { id: 'floor', x: 1100, left: 100, right: 2100, top: 900, bottom: 940,
      collision: { up: true, down: true, left: true, right: true } };
    const wall = { id: 'wall', x: 1200, left: 1190, right: 1210, top: 500, bottom: 900,
      collision: { up: false, down: false, left: true, right: true } };
    h.room.geometry = { ...h.room.geometry, mapId: 993, colliders: [floor, wall] };
    h.place(h.p, 1000, floor);
    h.place(enemy, 1400, floor);
    h.brain.random = () => 0.5;
    assert.equal(hasClearShot(h.room, h.p, enemy), false);
    h.think();
    assert.ok(Math.abs(h.brain.decision.goal.x - h.p.x) > 80, 'blocked firing ground is not treated as a useful hold');
  });

  for (const [character, separation] of [['sparrow', 600], ['thorg', 200]]) {
    test(`${character} can execute a useful super independently of basic attack range`, (t) => {
      const h = setup(t, [character, 'ozzy']), enemy = h.players[1];
      h.place(enemy, h.p.x + separation);
      enemy.health = enemy.maxHealth * 0.4;
      h.brain.random = () => 0.5;
      h.p.superCharge = h.p.maxSuperCharge;
      h.brain.ammoReadyAfter = h.now() + 10000;
      const observed = h.snapshot();
      updateSuperPlan(h.brain, observed.enemies, h.now() - 5000);
      updateSuperPlan(h.brain, observed.enemies, h.now());
      assert.equal(basicAim(h.p, enemy, h.brain.profile, () => 0.5).canHit, false);
      h.brain.tryCombat(observed.enemies, observed.enemies[0], observed, h.now());
      assert.equal(h.brain.metrics.specials, 1);
      assert.equal(h.brain.metrics.attacks, 0);
      assert.ok(h.p.superCharge < h.p.maxSuperCharge);
    });
  }

  test('perception sees approaching enemy shots, not departing or friendly ones', (t) => {
    const h = setup(t, ['ninja', 'sparrow']), enemy = h.players[1];
    enemyFires(h, enemy, h.p.x);
    assert.ok(incomingThreat(h.snapshot(), h.p, h.now()), 'an enemy shot at the bot, still in its windup');
    assert.equal(observe(h.room, enemy, h.now()).projectiles.length, 0, 'its own team does not dodge it');
    h.advance(90);
    enemyFires(h, enemy, enemy.x + 300);
    assert.equal(incomingThreat(h.snapshot(), h.p, h.now()), null, 'a shot fired away from the bot');
  });

  for (const trophies of [0, 2000]) {
    test(`a ${trophies}-trophy bot can choose a safe dodge for an incoming ranged attack`, (t) => {
      const h = setup(t, ['ninja', 'sparrow'], trophies), enemy = h.players[1];
      h.brain.random = () => 0.2;
      enemyFires(h, enemy, h.p.x);
      const observed = h.snapshot();
      assert.ok(incomingThreat(observed, h.p, h.now()));
      assert.equal(h.brain.tryDodge(observed, {}, h.now(), Infinity), true);
      assert.equal(h.brain.metrics.dodges, 1);
      assert.equal(h.brain.maneuver.end.grounded, true, 'dodge has a verified landing');
    });
  }

  test('bots duck an imminent hit only when no safer dodge exists', (t) => {
    const h = setup(t, ['ninja', 'sparrow'], 1250), enemy = h.players[1];
    h.p._dashReadyAt = h.now() + 5000; // Neither a dash nor an ordinary dodge is available.
    h.brain.random = () => 0;
    h.brain.openingUntil = 0;
    h.brain.findDodgeSteps = function* () { return { best: null, baseDanger: 100, bestScore: 100 }; };
    enemyFires(h, enemy, h.p.x);
    h.think();
    assert.equal(h.p.ducking, true);
    assert.equal(h.brain.metrics.strategicDucks, 1);
    assert.ok(h.brain.duckUntil > h.now());
    assert.ok(h.brain.nextStrategicDuckAt > h.brain.duckUntil);
  });

  test('bots prefer an available dodge instead of stacking a duck', (t) => {
    const h = setup(t, ['ninja', 'sparrow'], 2000), enemy = h.players[1];
    h.brain.random = () => 0;
    enemyFires(h, enemy, h.p.x);
    const observed = h.snapshot();
    const threat = incomingThreat(observed, h.p, h.now());
    const dodge = h.brain.findDodgeManeuver(observed, {}, h.now(), Infinity);
    assert.ok(dodge.best);
    assert.equal(h.brain.tryDodge(observed, {}, h.now(), Infinity, dodge), true);
    assert.notEqual(h.p.ducking, true);
    assert.equal(h.brain.metrics.strategicDucks, 0);
    assert.ok(threat);
  });

  test('occasional flavor ducks stay spaced out and never start under pressure', (t) => {
    const h = setup(t);
    h.brain.random = () => 0;
    h.brain.nextFlavorDuckAt = h.now();
    h.p.vx = 0;
    assert.equal(h.brain.maybeFlavorDuck(false, h.now()), true);
    assert.equal(h.brain.metrics.flavorDucks, 1);
    const firstDeadline = h.brain.nextFlavorDuckAt;
    assert.ok(firstDeadline >= h.now() + 7500);
    h.brain.duckUntil = 0;
    h.p.ducking = false;
    assert.equal(h.brain.maybeFlavorDuck(false, h.now() + 1000), false);
    h.brain.nextFlavorDuckAt = h.now();
    assert.equal(h.brain.maybeFlavorDuck(true, h.now()), false);
    assert.equal(h.brain.metrics.flavorDucks, 1);
  });

  test('some bot ducks move safely and sometimes hold for longer', (t) => {
    const h = setup(t);
    h.brain.random = () => 0;
    h.brain.intent = { direction: 1 };
    const startedAt = h.now();
    const x = h.p.x;
    assert.equal(h.brain.startDuck(startedAt, 300, 'flavor'), true);
    assert.equal(h.brain.duckDirection, 1);
    assert.ok(h.brain.duckUntil >= startedAt + 750);
    h.brain.openingUntil = 0;
    h.brain.nextThink = Infinity;
    h.brain.tick(1000 / 60, startedAt + 1000 / 60);
    assert.ok(h.p.x > x, 'moving duck advances at reduced speed');

    h.brain.duckUntil = 0;
    h.p.ducking = false;
    h.brain.random = () => 0.99;
    assert.equal(h.brain.startDuck(startedAt + 2000, 300, 'flavor'), true);
    assert.equal(h.brain.duckDirection, 0, 'not every duck has to move');
    assert.equal(h.brain.duckUntil, startedAt + 2300, 'ordinary ducks stay brief');
  });

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
    for (const character of ['ninja', 'thorg', 'draven', 'ozzy', 'sparrow', 'gloop']) {
      const player = { participantId: 'bot', char_class: character, team: 'team1', x: 500, y: 400,
        vx: 0, vy: 0, grounded: true, isAlive: true, loaded: true, connected: true,
        health: 1000, maxHealth: 1000, superCharge: 100, maxSuperCharge: 100 };
      const target = { participantId: 'enemy', char_class: 'ninja', team: 'team2', x: 850, y: 400,
        vx: 100, vy: 0, grounded: true, health: 400, maxHealth: 1000 };
      if (character === 'thorg' || character === 'draven') target.x = 650;
      if (character === 'ozzy') player.health = 500;
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

  test('human Sparrow flight is authoritative and visible to bots without duplicate releases', (t) => {
    const h = setup(t, ['sparrow', 'ninja']), [human, bot] = h.players;
    const combat = require('../src/shared/combat/runtime/sparrowCombat.js');
    human.isBot = false;
    assert.equal(h.room.handlePlayerAction(human.participantId, { type: 'sparrow-arrow', id: 'human-shot', angle: 0 }), true);
    h.room.tickId += 10;
    h.room.simulationMono = h.now();
    combat.tick(h.room);
    const count = h.room.sparrowCombatState.active.size;
    assert.ok(count > 0);
    assert.ok(observe(h.room, bot, h.now(), new WeakMap()).projectiles.length > 0);
    assert.equal(registerAttackFromAction(h.room, human, { type: 'sparrow-arrow-release', id: 'human-shot' }, h.now()), false);
    assert.equal(h.room.sparrowCombatState.active.size, count);
    assert.equal(h.room.activeAttacks?.length || 0, 0);
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

  test('bots back up and climb when a route takeoff is hidden behind a solid obstruction', (t) => {
    const { getDuelGeometry } = require('../src/shared/physics/duelGeometry');
    const h = setup(t, ['ninja', 'ozzy']);
    h.room.geometry = getDuelGeometry(2);
    const floor = h.room.geometry.colliders.find((surface) => surface.id === 'p0');
    const centerBlock = h.room.geometry.colliders.find((surface) => surface.id === 'p1');
    const destination = h.room.geometry.colliders.find((surface) => surface.id === 'p3');
    const enemy = h.players[1];
    h.place(h.p, centerBlock.left - 75, floor);
    h.place(enemy, centerBlock.right + 75, floor);
    enemy.health = enemy.maxHealth = 1000000;
    h.brain.openingUntil = 0;
    h.brain.nextIdleAt = Infinity;
    h.brain.random = () => 0.5;
    h.players[1].isAlive = false;
    h.brain.retreating = false;
    h.brain.context(effects.getModifiers(h.p, h.now()), h.now());
    h.brain.decision = { mode: 'reposition', goal: {
      x: destination.x,
      y: destination.top,
      surfaceId: destination.id,
    } };
    h.brain.nextDecisionAt = Infinity;

    let climbed = false;
    for (let i = 0; i < 360; i++) {
      h.advance(1);
      climbed ||= h.p.platformId === centerBlock.id || bounds(h.p).bottom < centerBlock.top + 20;
    }

    assert.equal(climbed, true, 'uses a simulated climb instead of standing against the wall');
    assert.ok(h.brain.metrics.stuckMs < 1800, `only stalled for ${h.brain.metrics.stuckMs}ms`);
    assert.equal(h.brain.metrics.unforcedFalls, 0);
  });

  test('bots hop over Bank Bust steps instead of pushing against their sides', (t) => {
    const { getDuelGeometry } = require('../src/shared/physics/duelGeometry');
    const h = setup(t, ['ninja', 'ozzy']);
    h.room.geometry = getDuelGeometry(4);
    const floor = h.room.geometry.colliders.find((surface) => surface.id === 'floor-l-body');
    const step = h.room.geometry.colliders.find((surface) => surface.id === 'hill-l-1-body');
    const destination = h.room.geometry.colliders.find((surface) => surface.id === 'hill-l-2-body');
    h.place(h.p, step.left - 60, floor);
    h.place(h.players[1], destination.x, destination);
    h.players[1].health = h.players[1].maxHealth = 1000000;
    h.brain.openingUntil = 0;
    h.brain.nextIdleAt = Infinity;
    h.brain.random = () => 0.5;
    h.players[1].isAlive = false;
    h.brain.retreating = false;
    h.brain.context(effects.getModifiers(h.p, h.now()), h.now());
    h.brain.decision = { mode: 'reposition', goal: {
      x: destination.x,
      y: destination.top,
      surfaceId: destination.id,
    } };
    h.brain.nextDecisionAt = Infinity;

    let clearedStep = false;
    for (let i = 0; i < 180; i++) {
      h.advance(1);
      clearedStep ||= bounds(h.p).left > step.right + 4;
    }

    assert.equal(clearedStep, true, 'lands beyond the step');
    assert.equal(h.brain.metrics.unforcedFalls, 0);
  });

  test('bots keep a safe platform route when the tactical decision timer expires', (t) => {
    const h = setup(t);
    h.think();
    const context = h.brain.context(effects.getModifiers(h.p, h.now()), h.now());
    const destination = context.graph.surfaces.find((s) => context.routeTo(s.id)?.length);
    assert.ok(destination);
    h.brain.decision = { mode: 'reposition', goal: { x: destination.x, y: destination.top, surfaceId: destination.id } };
    h.brain.navigate(context, h.now());
    const decision = h.brain.decision;
    assert.ok(h.brain.approachEdge);
    h.brain.nextDecisionAt = 0;
    h.think();
    assert.equal(h.brain.decision, decision);
  });

  test('holding a platform eventually encourages a reachable alternative firing angle', (t) => {
    const { chooseDecision } = require('../src/server/core/bots/tactics');
    const h = setup(t), enemy = h.players[1];
    h.place(enemy, h.p.x + preferredRange(h.brain, enemy));
    h.think();
    const original = h.brain.context(effects.getModifiers(h.p, h.now()), h.now());
    const current = original.current;
    const alternate = { ...current, id: 'alternate', left: h.p.x - 150, right: h.p.x + 150,
      x: h.p.x, top: current.top - 80 };
    const context = { ...original, graph: { ...original.graph, surfaces: [current, alternate] },
      routeTo: (id) => id === current.id ? [] : [{ to: alternate.id, duration: 500 }] };
    context.routeSteps = function* (id) { return context.routeTo(id); };
    h.brain.surfaceEnteredAt = h.now();
    h.brain.visited.clear();
    h.brain.superPlan = null;
    h.brain.kiteUntil = 0;
    h.brain.retreating = false;
    assert.equal(chooseDecision(h.brain, context, enemy, [enemy], h.now()).goal.surfaceId, current.id);
    h.brain.surfaceEnteredAt = h.now() - 16000;
    const decision = chooseDecision(h.brain, context, enemy, [enemy], h.now());
    assert.equal(decision.goal.surfaceId, alternate.id);
    assert.ok(context.routeTo(decision.goal.surfaceId)?.length);
  });

  test('bots hold high ground instead of dropping into a remembered stream of fire', (t) => {
    const { chooseDecision } = require('../src/server/core/bots/tactics');
    const { updateFireLanes } = require('../src/server/core/bots/perception');
    const h = setup(t, ['sparrow', 'ninja']), enemy = h.players[1];
    const solid = { up: true, down: true, left: true, right: true };
    const floor = { id: 'floor', x: 1100, left: 100, right: 2100, top: 900, bottom: 940, collision: solid };
    const ledge = { id: 'ledge', x: 550, left: 300, right: 800, top: 620, bottom: 660, collision: solid };
    h.room.geometry = { ...h.room.geometry, mapId: 993, colliders: [floor, ledge] };
    h.place(h.p, 550, ledge);
    h.place(enemy, 1500, floor);
    Object.assign(h.brain, { openingUntil: 0, superPlan: null, retreating: false, random: () => 0.5 });
    const context = h.brain.context(effects.getModifiers(h.p, h.now()), h.now());
    assert.equal(chooseDecision(h.brain, context, enemy, [enemy], h.now()).goal.surfaceId, floor.id,
      'without fire the bot drops down to fight');
    // A swarm of shots streaming along the floor toward the ledge.
    const shots = Array.from({ length: 10 }, (_, i) => ({ x: enemy.x - 50 - i * 90, y: enemy.y + (i % 3 - 1) * 20,
      vx: -1400, vy: 0, gravity: 0, radius: 14, ownerId: enemy.participantId }));
    h.brain.fireLanes = updateFireLanes(null, { at: h.now(), enemies: [enemy], projectiles: shots }, h.now());
    assert.equal(chooseDecision(h.brain, context, enemy, [enemy], h.now()).goal.surfaceId, ledge.id);
    // The lane outlasts a short pause in fire, then is forgotten.
    h.brain.fireLanes = updateFireLanes(h.brain.fireLanes, { at: h.now() + 400, enemies: [enemy], projectiles: [] }, h.now() + 400);
    assert.equal(chooseDecision(h.brain, context, enemy, [enemy], h.now() + 400).goal.surfaceId, ledge.id);
    h.brain.fireLanes = updateFireLanes(h.brain.fireLanes, null, h.now() + 5000);
    assert.equal(h.brain.fireLanes.size, 0);
  });

  test('a bot stays out of the curved path of repeated Ninja swarms on Lushy Peaks', (t) => {
    const ninjaCombat = require('../src/shared/combat/runtime/ninjaCombat.js');
    const h = setup(t, ['sparrow', 'ninja']), ninja = h.players[1];
    const surface = (id) => h.room.geometry.colliders.find((collider) => collider.id === id);
    // Sparrow starts on the right pillar; the Ninja sweeps the main floor below it.
    h.place(h.p, surface('p3').x, surface('p3'));
    h.place(ninja, surface('p0').left + 150, surface('p0'));
    Object.assign(ninja, { health: 1e9, maxHealth: 1e9, connected: true, loaded: true });
    // A fixed sequence of choices that took the drop into the stream before.
    let state = 9301;
    Object.assign(h.brain, { openingUntil: 0, random: () => (state = (state * 9301 + 49297) % 233280) / 233280 });
    for (let frame = 0; frame < 600; frame++) {
      if (frame % 50 === 0) {
        ninja.superCharge = ninja.maxSuperCharge;
        ninjaCombat.request(h.room, ninja, { id: `swarm-${frame}`, angle: 0, aim: { angle: 0 } }, true);
      }
      h.advance(1);
    }
    assert.ok(h.p.isAlive);
    assert.ok(h.p.health > h.p.maxHealth / 2, `took ${h.p.maxHealth - h.p.health} damage`);
    assert.ok(ninja.health < ninja.maxHealth, 'still fights from outside the stream');
  });

  test('Sparrow takes the far exit to attack a Ninja firing under the platform', (t) => {
    const { chooseDecision } = require('../src/server/core/bots/tactics');
    const { updateFireLanes } = require('../src/server/core/bots/perception');
    const h = setup(t, ['sparrow', 'ninja']), enemy = h.players[1];
    const collision = { up: true, down: true, left: true, right: true };
    const floor = { id: 'floor', x: 1100, left: 100, right: 2100, top: 900, bottom: 940, collision };
    const ledge = { id: 'ledge', x: 1000, left: 450, right: 1550, top: 620, bottom: 660, collision };
    h.room.geometry = { ...h.room.geometry, mapId: 994, colliders: [floor, ledge] };
    h.place(h.p, 620, ledge);
    h.place(enemy, 1100, floor);
    const shots = Array.from({ length: 10 }, (_, i) => ({ x: enemy.x - i * 70, y: enemy.y,
      vx: -1400, vy: 0, radius: 14, ownerId: enemy.participantId }));
    h.brain.fireLanes = updateFireLanes(null, { at: h.now(), enemies: [enemy], projectiles: shots }, h.now());
    const context = h.brain.context(effects.getModifiers(h.p, h.now()), h.now());
    h.brain.decision = chooseDecision(h.brain, context, enemy, [enemy], h.now());
    const goal = h.brain.decision.goal;
    assert.equal(goal.surfaceId, floor.id);
    assert.ok(goal.x > enemy.x);
    h.brain.navigate(context, h.now());
    assert.ok(h.brain.approachEdge.takeoffX > enemy.x);
    const stance = standOn(floor, h.p.char_class, goal.x);
    const shooter = { ...h.p, ...stance };
    const aim = basicAim(shooter, enemy, h.brain.profile, () => 0.5, h.room);
    assert.ok(aim.canHit && hasClearShot(h.room, shooter, enemy, aim));
    const thinkSteps = h.brain.thinkSteps.bind(h.brain);
    t.mock.method(h.brain, 'thinkSteps', (observed, mods, now) =>
      thinkSteps(observed && { ...observed, projectiles: shots }, mods, now));
    const initialHealth = enemy.health;
    for (let frame = 0; frame < 720; frame++) {
      h.advance(1);
      if (h.p.platformId === floor.id && h.p.x > enemy.x && enemy.health < initialHealth) break;
    }
    assert.equal(h.p.platformId, floor.id);
    assert.ok(h.p.x > enemy.x && enemy.health < initialHealth, 'lands behind the stream and damages the shooter');
  });

  for (const [index, character] of ['ninja', 'ozzy', 'draven', 'thorg', 'gloop', 'sparrow'].entries()) {
    test(`${character} reroutes around sustained fire on the way down`, (t) => {
      const { updateFireLanes } = require('../src/server/core/bots/perception');
      const h = setup(t, [character, 'ozzy']);
      const collision = { up: true, down: true, left: true, right: true };
      const floor = { id: 'ground', x: 1100, left: 100, right: 2100, top: 900, bottom: 940, collision };
      const upper = { id: 'upper', x: 1100, left: 650 - index * 15, right: 1550 + index * 15,
        top: 540 + index * 10, bottom: 580 + index * 10, collision };
      h.room.geometry = { ...h.room.geometry, mapId: 9960 + index, colliders: [floor, upper] };
      const side = index % 2 ? 1 : -1;
      h.place(h.p, upper.x + side * 300, upper);
      const context = () => h.brain.context(effects.getModifiers(h.p, h.now()), h.now());
      const route = () => context().routeTo(floor.id)[0];
      const direct = route();
      assert.equal(Math.sign(direct.takeoffX - upper.x), side);
      const midFlight = direct.frames.find(frame => frame.y > upper.bottom);
      assert.ok(midFlight);
      const shots = Array.from({ length: 12 }, (_, i) => ({
        x: (side > 0 ? upper.right : upper.left) + side * i * 55, y: midFlight.y - i * 5, vx: side * 50, vy: 1000,
        gravity: 0, radius: 20, ownerId: 'opponent',
      }));
      h.brain.fireLanes = updateFireLanes(null, { at: h.now(), enemies: [], projectiles: shots }, h.now());
      assert.equal(Math.sign(route().takeoffX - upper.x), -side);
      h.brain.fireLanes = updateFireLanes(h.brain.fireLanes, null, h.now() + 5000);
      assert.equal(route(), direct);
    });
  }

  test('a bot can leave its goal platform to bypass fire across the final walk', (t) => {
    const { updateFireLanes } = require('../src/server/core/bots/perception');
    const h = setup(t, ['gloop', 'draven']);
    const collision = { up: true, down: true, left: true, right: true };
    const floor = { id: 'ground', x: 1100, left: 100, right: 2100, top: 900, bottom: 940, collision };
    const bridge = { id: 'bridge', x: 1100, left: 850, right: 1350, top: 735, bottom: 760, collision };
    h.room.geometry = { ...h.room.geometry, mapId: 9970, colliders: [floor, bridge] };
    h.place(h.p, 650, floor);
    const route = () => h.brain.context(effects.getModifiers(h.p, h.now()), h.now()).routeTo(floor.id, 1550);
    assert.deepEqual(route(), []);
    const shots = Array.from({ length: 12 }, (_, i) => ({
      x: 1000 + i * 16, y: h.p.y, vx: 0, vy: 800, gravity: 0, radius: 14, ownerId: 'opponent',
    }));
    h.brain.fireLanes = updateFireLanes(null, { at: h.now(), enemies: [], projectiles: shots }, h.now());
    assert.deepEqual(route().map(edge => edge.to), [bridge.id, floor.id]);
  });

  test('sampled navigation routes land on their advertised platforms under real physics', () => {
    const { buildGraph, standOn } = require('../src/server/core/bots/navigation');
    const { getDuelGeometry } = require('../src/shared/physics/duelGeometry');
    const { stepBody } = require('../src/server/core/physics/bodySolver');
    let replayed = 0;
    for (const map of [1, 2, 3]) {
      const geometry = getDuelGeometry(map), graph = buildGraph(geometry, 'sparrow');
      for (const [from, edges] of graph.edges) {
        for (const edge of edges) {
          const p = standOn(graph.surfaces.find((s) => s.id === from), 'sparrow', edge.takeoffX);
          edge.frames.forEach((input, i) => {
            p.flip = input.direction < 0;
            assert.equal(stepBody(p, input, geometry, 1000 / 60, i * 1000 / 60).fell, false);
          });
          assert.equal(p.grounded, true);
          assert.equal(p.platformId, edge.to);
          replayed++;
        }
      }
    }
    assert.ok(replayed > 10);
  });

  test('one route search answers every Bank Bust destination the same as separate searches', () => {
    const { getDuelGeometry } = require('../src/shared/physics/duelGeometry');
    const { buildGraph, createRouteSearch, findRoute } = require('../src/server/core/bots/navigation');
    const graph = buildGraph(getDuelGeometry(4), 'ninja');
    const start = graph.surfaces.find((surface) => surface.id === 'chamber-l-3-body');
    const options = { allowDash: true, startX: start.x };
    const search = createRouteSearch(graph, start.id, Infinity, options);
    for (const surface of graph.surfaces) for (const goalX of [undefined, surface.left, surface.right]) {
      assert.deepEqual(search(surface.id, goalX), findRoute(graph, start.id, surface.id, Infinity, { ...options, goalX }), `${surface.id} at ${goalX}`);
    }
  });

  test('route queries paused between expansions and interleaved answer as uninterrupted ones do', () => {
    const { getDuelGeometry } = require('../src/shared/physics/duelGeometry');
    const { buildGraph, createRouteSearch } = require('../src/server/core/bots/navigation');
    const graph = buildGraph(getDuelGeometry(4), 'ninja');
    const start = graph.surfaces.find((surface) => surface.id === 'chamber-l-3-body');
    const options = { allowDash: true, startX: start.x };
    const whole = createRouteSearch(graph, start.id, Infinity, options);
    const sliced = createRouteSearch(graph, start.id, Infinity, options);
    const queries = graph.surfaces.flatMap((surface) => [undefined, surface.right].map((goalX) => ({
      surface, goalX, steps: sliced.steps(surface.id, goalX), pauses: 0 })));
    // Advance every query one slice at a time, round robin.
    let open = queries;
    while (open.length) {
      open = open.filter((query) => {
        const result = query.steps.next();
        if (!result.done) { query.pauses++; return true; }
        query.route = result.value;
        return false;
      });
    }
    assert.ok(queries.some((query) => query.pauses > 0), 'long queries pause');
    for (const query of queries) {
      assert.deepEqual(query.route, whole(query.surface.id, query.goalX), `${query.surface.id} at ${query.goalX}`);
    }
  });
});

describe("Disconnected living targets", () => {
  const { makeRoom } = require('./helpers/botRoom');
  const inferno = require('../src/shared/combat/runtime/abilities/dravenInfernoAbility.js');
  const { observe } = require('../src/server/core/bots/perception');

  test('bots see disconnected living enemies and Inferno damages them', t => {
    const { room, players: [caster, target] } = makeRoom({ characters: ['draven', 'ozzy'] });
    t.after(() => room.cleanup());
    Object.assign(caster, { x: 100, y: 200, connected: true });
    Object.assign(target, { x: 130, y: 200, connected: false, socketId: null });
    assert.equal(observe(room, caster, 1000, new Map()).enemies.length, 1);
    const health = target.health;
    inferno.activate(caster, 1000);
    inferno.tick(room, caster, 1100);
    assert.ok(target.health < health);
    target.isAlive = false;
    assert.equal(observe(room, caster, 1200, new Map()).enemies.length, 0);
  });
});
