const test = require("node:test");
const assert = require("node:assert/strict");

const catalog = require("../src/shared/catalogs/gameModes.catalog.json");
const { createGameModeRuntime } = require("../src/server/core/gameModes");
const {
  BOT_OBJECTIVE_SCHEMA_VERSION,
  resolveBotObjective,
} = require("../src/server/core/bots/objectives");

function roomFor(mode) {
  const room = {
    matchData: {
      modeId: mode.id,
      modeVariantId: mode.defaultVariantId || null,
      map: mode.id === "bank-bust" ? 4 : 1,
      players: [],
    },
    players: new Map(),
    modeState: null,
  };
  room.gameMode = createGameModeRuntime(room);
  room.modeState = room.gameMode.createRoomState();
  return room;
}

test("every game mode advertises bot support and an objective directive", () => {
  for (const mode of catalog.modes) {
    assert.equal(mode.capabilities.aiBots, true, `${mode.id} supports bots`);
    assert.ok(mode.botObjective?.kind, `${mode.id} has an objective kind`);
    assert.ok(mode.botObjective?.label, `${mode.id} has an objective label`);

    const room = roomFor(mode);
    const objective = resolveBotObjective(room, {
      participantId: "bot:test",
      isBot: true,
      team: "team1",
    });
    assert.equal(objective.schemaVersion, BOT_OBJECTIVE_SCHEMA_VERSION);
    assert.equal(objective.modeId, mode.id);
    assert.equal(objective.kind, mode.botObjective.kind);
    assert.equal(objective.behavior, mode.id === "bank-bust" ? "bank-objectives" : "standard-combat");
  }
});

test("Bank Bust exposes a team-specific vault target with objective AI", () => {
  const mode = catalog.modes.find((entry) => entry.id === "bank-bust");
  const objective = resolveBotObjective(roomFor(mode), {
    participantId: "bot:test",
    isBot: true,
    team: "team1",
  });

  assert.equal(objective.kind, "destroy-vault");
  assert.equal(objective.targetTeam, "team2");
  assert.deepEqual(objective.target, {
    id: "team2-vault",
    type: "vault",
    team: "team2",
    x: objective.goal.x,
    y: objective.goal.y,
  });
  assert.equal(objective.interaction, "damage");
  assert.equal(objective.behavior, "bank-objectives");
});

const { bankRole, bankDecisionSteps, objectiveShot, tryBankInteraction, bankCombatEnemies, purchaseAllowed, wantsBankPurchase } = require('../src/server/core/bots/bankBust');
const { finishSteps } = require('../src/server/core/bots/tactics');
const { standOn } = require('../src/server/core/bots/navigation');
function bankSetup() {
  const room = roomFor(catalog.modes.find(m => m.id === 'bank-bust'));
  const surface = { id: 'floor', left: 0, right: 4000, top: 500, x: 2000, collision: { up: true } };
  room.geometry = { colliders: [surface] };
  const p = { ...standOn(surface, 'ninja', 800), participantId: 'bot:1', name: 'Bot', team: 'team1', isBot: true,
    isAlive: true, loaded: true, health: 1000, maxHealth: 1000 };
  room.players.set(p.participantId, p);
  Object.assign(room.modeState.vaults.team1, { x: 300, y: p.y, coins: 100000 });
  Object.assign(room.modeState.vaults.team2, { x: 3500, y: p.y, coins: 100000 });
  room.modeState.objects = [];
  room.modeState.randomGold.pickups = [];
  room.modeState.centerGold.phase = 'scheduled';
  const brain = { room, player: p, profile: {}, bankRole: 'raider', bankClaimPlan: { willing: true, checkAt: Infinity } };
  const context = { graph: { surfaces: [surface] }, poisonY: Infinity, routeTo: () => [] };
  const decide = (enemies = [], now = 10000) => finishSteps(bankDecisionSteps(brain, context, enemies, now));
  return { room, p, brain, context, decide };
}

test('raiders advance to a reachable vault firing position and yield to defenders', () => {
  const h = bankSetup();
  const decision = h.decide();
  assert.equal(decision.mode, 'bank-siege');
  assert.ok(decision.goal.x > h.p.x);
  h.context.routeTo = () => null;
  assert.equal(h.decide(), null, 'unreachable goals are rejected');
  h.context.routeTo = () => [];
  assert.equal(h.decide([{ x: h.p.x + 100, y: h.p.y }]), null);
  h.brain.retreating = true;
  assert.equal(h.decide(), null, 'injured bots retain recovery tactics');
});

test('roles prioritize farming, announced crates, and a defensive area', () => {
  const h = bankSetup();
  h.brain.bankRole = 'farmer';
  h.room.modeState.objects.push({ id: 'mine', type: 'goldMine', x: 1000, y: h.p.y,
    state: { storedGold: 1000, collectionRadius: 100 } });
  assert.equal(h.decide().mode, 'bank-mine');
  h.room.modeState.objects = [];
  h.room.modeState.randomGold.pickups.push({ id: 'gold', x: 1000, y: h.p.y, radius: 42 });
  assert.equal(h.decide().mode, 'bank-gold');
  h.brain.bankRole = 'crate-hunter';
  Object.assign(h.room.modeState.centerGold, { phase: 'announced', x: 2000, y: h.p.y });
  assert.equal(h.decide().mode, 'bank-crate');
  h.room.modeState.randomGold.pickups = [];
  h.room.modeState.centerGold.phase = 'scheduled';
  h.brain.bankRole = 'defender';
  assert.equal(h.decide().mode, 'bank-siege', 'a quiet base needs no permanent guard');
});

test('bots take clear vault shots without a player target and respect defender pressure', () => {
  const h = bankSetup();
  h.p.x = 3350;
  assert.equal(objectiveShot(h.brain, []).id, 'vault:team2');
  assert.equal(objectiveShot(h.brain, [{ x: 3300, y: h.p.y }]), null);
  h.room.modeState.vaults.team2.destroyedAt = 100;
  assert.equal(objectiveShot(h.brain, []), null);
});

test('bot interactions use authoritative purchases and preserve a spending reserve', () => {
  const h = bankSetup();
  const turret = { id: 'turret', type: 'claimableTurret', x: h.p.x, y: h.p.y,
    state: { claimCost: 1000, claimRadius: 110 } };
  h.room.modeState.objects.push(turret);
  h.room.handlePlayerAction = (id, action) => h.room.gameMode.handlePlayerAction(h.room.players.get(id), action);
  const before = h.room.modeState.vaults.team1.coins;
  tryBankInteraction(h.brain, 10000);
  assert.equal(turret.state.claimedByTeam, 'team1');
  assert.equal(h.room.modeState.vaults.team1.coins, before - turret.state.claimCost);
  tryBankInteraction(h.brain, 13000);
  assert.equal(h.room.modeState.vaults.team1.coins, before - turret.state.claimCost, 'no repeat purchase');
  turret.state.claimedByTeam = null;
  h.room.modeState.vaults.team1.coins = h.room.modeState.purchaseFloorCoins + 1000;
  tryBankInteraction(h.brain, 16000);
  assert.equal(turret.state.claimedByTeam, null);
  h.room.modeState.vaults.team1.coins = before;
  h.room.modeState.objects = [{ id: 'wall', type: 'wallSlot', x: h.p.x, y: h.p.y,
    state: { cost: 1000, buildRadius: 100 } }];
  tryBankInteraction(h.brain, 19000);
  assert.equal(h.room.modeState.objects[0].state.builtByTeam, 'team1');
});

test('role assignment stays stable after teammates disappear', () => {
  const h = bankSetup();
  delete h.brain.bankRole;
  const role = bankRole(h.brain);
  h.room.players.clear();
  assert.equal(bankRole(h.brain), role);
});

test('controller fires a normal ammo-consuming attack at the vault with no observed opponents', () => {
  const h = bankSetup();
  const { BotController } = require('../src/server/core/bots/controller');
  h.p.x = 3350;
  Object.assign(h.p, { _botActionSeq: 0, superCharge: 0, maxSuperCharge: 100,
    ammoState: { charges: 2, capacity: 3, nextFireInMs: 0, cooldownMs: 400 } });
  let action;
  h.room.handlePlayerAction = (id, value) => { action = value; };
  Object.assign(h.brain, { nextOpportunity: 0, aggression: 1, random: () => 0.5,
    between: (a, b) => (a + b) / 2, attackHesitationMs: () => 100,
    profile: { prediction: 0.5, tacticalAwareness: 0.5, mistakeChance: 0 }, metrics: { attacks: 0 } });
  finishSteps(BotController.prototype.tryCombatSteps.call(h.brain, [], null, { at: 10000 }, 10000));
  assert.equal(h.brain.metrics.attacks, 1);
  assert.equal(h.p.ammoState.charges, 1);
  assert.equal(action.type, 'ninja-shuriken');
  assert.ok(action.target.x > h.p.x);
});

test('defenders push, return for an observed raid, then resume pushing after the alert clears', () => {
  const h = bankSetup();
  h.brain.bankRole = 'defender';
  h.p.x = 2400;
  assert.equal(h.decide().mode, 'bank-siege');
  const intruder = { participantId: 'enemy', x: 400, y: h.p.y };
  assert.equal(h.decide([intruder], 11000).mode, 'bank-guard', 'raid interrupts the offensive commitment');
  assert.equal(h.decide([], 11500).mode, 'bank-guard', 'a momentarily missing observation does not reverse the route');
  assert.equal(h.decide([], 20000).mode, 'bank-siege', 'does not camp after danger clears');
});

test('a nearby raider covers an undefended base instead of sticking to its personality', () => {
  const h = bankSetup();
  h.p.x = 2000;
  const intruder = { participantId: 'enemy', x: 400, y: h.p.y };
  assert.equal(h.decide([intruder]).mode, 'bank-guard');
  assert.equal(h.brain.bankSituation.role, 'defender');
  h.room.players.set('ally', { participantId: 'ally', isBot: true, isAlive: true, team: h.p.team, x: 600, y: h.p.y });
  h.brain.bankGuardUntil = 0;
  assert.equal(h.decide([intruder], 20000).mode, 'bank-siege', 'closer teammate can cover the base');
});

test('bank combat uses engagement hysteresis and ignores irrelevant distant players', () => {
  const h = bankSetup();
  const enemy = { participantId: 'enemy', x: h.p.x + 400, y: h.p.y };
  assert.deepEqual(bankCombatEnemies(h.brain, [enemy], 10000), []);
  h.brain.decision = { mode: 'fight' };
  assert.deepEqual(bankCombatEnemies(h.brain, [enemy], 11000), [enemy], 'keeps an established fight at the boundary');
  enemy.x = 2300;
  assert.deepEqual(bankCombatEnemies(h.brain, [enemy], 12000), [], 'does not chase indefinitely');
});

test('commitments keep the same objective and stance across small changes, but release completed goals', () => {
  const h = bankSetup();
  h.brain.bankRole = 'farmer';
  h.room.modeState.randomGold.pickups = [
    { id: 'left', x: 700, y: h.p.y, radius: 42 },
    { id: 'right', x: 910, y: h.p.y, radius: 42 },
  ];
  const first = h.decide();
  assert.equal(first.bankObjectiveId, 'left');
  h.brain.decision = first;
  h.p.x += 20;
  assert.deepEqual(h.decide([], 11000), first, 'small movement cannot reverse the goal');
  assert.deepEqual(h.decide([], 16000), first, 'switch margin preserves the goal after the minimum commitment');
  h.room.modeState.randomGold.pickups.shift();
  assert.equal(h.decide([], 16500).bankObjectiveId, 'right', 'collected goal releases immediately');
});

test('lost affordability invalidates a claim goal and simultaneous buyers recheck current coins', () => {
  const h = bankSetup();
  const turret = { id: 'turret', type: 'claimableTurret', x: h.p.x, y: h.p.y,
    state: { claimCost: 10000, claimRadius: 110 } };
  h.room.modeState.objects = [turret];
  assert.equal(h.decide().mode, 'bank-claim');
  h.room.modeState.vaults.team1.coins = 10000;
  assert.equal(h.decide([], 10500).mode, 'bank-siege');
  assert.equal(purchaseAllowed(h.brain, turret), false);
  h.room.modeState.purchaseFloorCoins = 0;
  assert.equal(h.room.gameMode.canAffordPurchase('team1', 10000), false, 'zero coins always loses and is never spendable');
  h.room.modeState.vaults.team1.coins = 25000;
  h.room.handlePlayerAction = (id, action) => h.room.gameMode.handlePlayerAction(h.room.players.get(id), action);
  tryBankInteraction(h.brain, 20000);
  assert.equal(turret.state.claimedByTeam, 'team1');
  h.room.modeState.objects = [{ ...turret, id: 'second', state: { ...turret.state, claimedByTeam: null } }];
  tryBankInteraction({ ...h.brain, nextBankInteraction: 0 }, 20000);
  assert.equal(h.room.modeState.objects[0].state.claimedByTeam, null, 'second buyer uses the reduced balance');
});

test('bots preserve a winning vault balance near the timer and reject finished-game purchases', () => {
  const h = bankSetup();
  const turret = { type: 'claimableTurret', x: h.p.x, y: h.p.y, state: { claimCost: 10000 } };
  h.room._botNow = 10000;
  h.room.modeState.endsAt = 15000;
  h.room.modeState.vaults.team2.coins = 95000;
  assert.equal(purchaseAllowed(h.brain, turret), false);
  h.room.modeState.endsAt = 100000;
  assert.equal(purchaseAllowed(h.brain, turret), true);
  h.room.modeState.phase = 'finished';
  assert.equal(purchaseAllowed(h.brain, turret), false);
  assert.equal(h.room.gameMode.canAffordPurchase('team1', 1), false);
});

test('opening claim willingness is uncommon and repeated thinks do not reroll it', () => {
  const h = bankSetup();
  delete h.brain.bankClaimPlan;
  let rolls = 0;
  h.brain.bankClaimRandom = () => { rolls++; return 0.5; };
  assert.equal(wantsBankPurchase(h.brain, 10000), false);
  const checkAt = h.brain.bankClaimPlan.checkAt;
  const initialRolls = rolls;
  for (let i = 0; i < 100; i++) assert.equal(wantsBankPurchase(h.brain, 10001 + i), false);
  assert.equal(rolls, initialRolls, 'think frequency cannot turn reluctance into a purchase');
  h.brain.bankClaimRandom = () => 0;
  assert.equal(wantsBankPurchase(h.brain, checkAt + 1), true, 'willingness can change later');
  let early = 0;
  for (let i = 0; i < 100; i++) {
    const brain = { ...h.brain, player: { ...h.p, participantId: `bot:${i}`, seed: i },
      bankClaimPlan: null, bankClaimRandom: null };
    if (wantsBankPurchase(brain, 10000)) early++;
  }
  assert.ok(early > 0 && early < 30, `early buyers should be a minority: ${early}`);
});

test('reluctance blocks both claim routing and opportunistic interaction', () => {
  const h = bankSetup();
  h.brain.bankClaimPlan.willing = false;
  h.room.modeState.objects = [{ id: 'turret', type: 'claimableTurret', x: h.p.x, y: h.p.y,
    state: { claimCost: 1000, claimRadius: 110 } }];
  let purchases = 0;
  h.room.handlePlayerAction = () => purchases++;
  assert.equal(h.decide().mode, 'bank-siege');
  tryBankInteraction(h.brain, 10000);
  assert.equal(purchases, 0);
});

test('team styles stay stable between reviews, evolve over time, and keep infiltrators a minority', () => {
  const h = bankSetup();
  h.room.modeState.startedAt = 1000;
  const brains = Array.from({ length: 6 }, (_, i) => ({ room: h.room,
    player: { ...h.p, participantId: `bot:${i}`, seed: i + 77 } }));
  h.room.players = new Map(brains.map(b => [b.player.participantId, b.player]));
  const histories = brains.map(() => new Set());
  const specialists = new Set();
  for (let period = 0; period < 20; period++) {
    const now = 1000 + period * 60000;
    const roles = brains.map((brain, i) => {
      const role = bankRole(brain, now);
      histories[i].add(role);
      assert.equal(bankRole(brain, now + 200), role, 'does not change its mind each think');
      return role;
    });
    const rushers = roles.filter(r => ['rusher', 'flanker'].includes(r));
    rushers.forEach(r => specialists.add(r));
    assert.ok(rushers.length > 0 && rushers.length < brains.length / 2, 'team retains supporting styles');
  }
  assert.ok(histories.every(history => history.size > 1), 'each bot can change style');
  assert.deepEqual([...specialists].sort(), ['flanker', 'rusher']);
});

test('rushers bypass incidental defenders, prioritize the vault, but fight immediate pressure', () => {
  const h = bankSetup();
  h.brain.bankRole = 'rusher';
  h.p.x = 3350;
  const defender = { participantId: 'enemy', x: 3600, y: h.p.y };
  h.room.modeState.randomGold.pickups = [{ id: 'coin', x: h.p.x, y: h.p.y, radius: 42 }];
  assert.equal(h.decide([defender]).mode, 'bank-siege');
  assert.equal(objectiveShot(h.brain, [defender]).id, 'vault:team2');
  defender.x = h.p.x + 50;
  assert.equal(h.decide([defender]), null, 'immediate contact still gets a combat response');
  assert.equal(objectiveShot(h.brain, [defender]), null);
  h.brain.retreating = true;
  assert.equal(h.decide([]), null, 'rushing does not disable recovery');
});

function wallSetup(builtByTeam) {
  const h = bankSetup();
  Object.assign(h.room.geometry, { world: { x: 0, y: 0, width: 4000, height: 1000 } });
  Object.assign(h.room.geometry.colliders[0], { bottom: 540, collision: { up: true, down: true, left: true, right: true } });
  h.room.modeState.objects = [{ id: 'wall', type: 'wallSlot', x: 1000, y: 452,
    state: { builtByTeam, width: 48, height: 96 } }];
  return h;
}

test('bots collide with built walls whichever team built them', () => {
  const { stepBody, bounds, movementGeometry } = require('../src/server/core/bots/physics');
  for (const builtByTeam of ['team1', 'team2']) {
    const h = wallSetup(builtByTeam);
    let now = 10000;
    for (let i = 0; i < 120; i++, now += 16) {
      stepBody(h.p, { direction: 1 }, movementGeometry(h.room), 16, now);
    }
    assert.ok(bounds(h.p).right <= 1000 - 24 + 0.5, `${builtByTeam} wall stops a team1 bot`);
  }
});

test('bots plan routes over built walls, their own team\'s included', () => {
  const { movementGeometry } = require('../src/server/core/bots/physics');
  const { buildGraph, createRouteSearch } = require('../src/server/core/bots/navigation');
  const routeAcross = (builtByTeam) => {
    const h = wallSetup(builtByTeam);
    const geometry = movementGeometry(h.room);
    assert.equal(movementGeometry(h.room), geometry, 'same walls reuse one geometry');
    const graph = buildGraph(geometry, h.p.char_class);
    return createRouteSearch(graph, 'floor', Infinity, { startX: h.p.x })('floor', 1400);
  };
  for (const builtByTeam of ['team1', 'team2']) {
    const route = routeAcross(builtByTeam);
    assert.ok(route?.length, `${builtByTeam} wall needs a route over it`);
    assert.ok(route.at(-1).landingX > 1024, 'the route ends past the wall');
  }
});

test('bots shoot through their own team\'s walls but not the other team\'s', () => {
  const { hasClearShot } = require('../src/server/core/bots/combat');
  const clear = (builtByTeam) => {
    const h = wallSetup(builtByTeam);
    const target = { ...h.p, participantId: 'enemy', team: 'team2', x: 1200 };
    return hasClearShot(h.room, h.p, target, { target: { x: target.x, y: target.y } });
  };
  assert.equal(clear('team2'), false);
  assert.equal(clear('team1'), true);
});

test('bot dashes stop at built walls whichever team built them', () => {
  const { stepBody, bounds, movementGeometry } = require('../src/server/core/bots/physics');
  const dash = (builtByTeam) => {
    const h = wallSetup(builtByTeam);
    h.p.x = 900;
    let now = 10000;
    for (let i = 0; i < 60; i++, now += 16) {
      stepBody(h.p, { direction: 1, dash: i === 0 ? { x: 1, y: 0 } : null }, movementGeometry(h.room), 16, now);
    }
    assert.ok(h.p._dashSeq > 0, 'the dash fired');
    return bounds(h.p);
  };
  assert.ok(dash('team2').right <= 1000 - 24 + 0.5, 'enemy wall stops the dash');
  assert.ok(dash('team1').right <= 1000 - 24 + 0.5, 'own wall stops the dash');
});
