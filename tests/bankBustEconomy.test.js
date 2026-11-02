// Bank Bust is built on one server-owned number per team: the coins in that
// team's vault. These tests hold that line — one value, server-owned, moved
// only through the mode's own transaction path — rather than pinning the
// tuning numbers, which are expected to be rebalanced.

const test = require("node:test");
const assert = require("node:assert/strict");

const { createGameModeRuntime } = require("../src/server/core/gameModes");
const { getModeById } = require("../src/shared/gameSelection");
const mapDocument = require("../src/shared/maps/4.json");
const { handleHit } = require("../src/server/core/gameRoom/damageResolver");
const {
  CENTER_CRATE_TARGET,
  getObjectiveTargets,
  hitCircleTargets,
} = require("../src/server/core/gameRoom/attackRuntimes/targets");

const SETTINGS = getModeById("bank-bust").settings;

function roomFor() {
  const room = {
    matchData: {
      modeId: "bank-bust",
      modeVariantId: "bank-bust-3v3",
      map: 4,
      players: [],
    },
    mapSnapshot: { map: mapDocument },
    players: new Map(),
    modeState: null,
  };
  room.gameMode = createGameModeRuntime(room);
  room.modeState = room.gameMode.createRoomState();
  return room;
}

function addPlayer(room, name, team, x, y) {
  const player = {
    name,
    team,
    x,
    y,
    isAlive: true,
    connected: true,
    loaded: true,
  };
  room.players.set(name, player);
  return player;
}

const layout = mapDocument.objectiveLayout.bankBust;

test("a vault holds one value, and the snapshot exposes no second pool", () => {
  const room = roomFor();
  const mode = room.gameMode;
  const snapshot = mode.buildModeState();

  for (const team of ["team1", "team2"]) {
    const vault = snapshot.vaults[team];
    assert.equal(vault.coins, SETTINGS.vaultStartingCoins);
    assert.equal(vault.startingCoins, SETTINGS.vaultStartingCoins);
    assert.equal(vault.health, undefined, "no health pool beside the coins");
    assert.equal(vault.maxHealth, undefined);
  }
  assert.equal(snapshot.teamGold, undefined, "no team wallet");
  assert.ok(snapshot.purchaseFloorCoins > 0, "purchases have a floor");
  assert.ok(
    snapshot.purchaseFloorCoins < SETTINGS.vaultStartingCoins,
    "the floor leaves something to spend",
  );
});

test("collected gold is paid into the collecting team's own vault", () => {
  const room = roomFor();
  const mode = room.gameMode;
  const before = mode.getVaultCoins("team1");

  const result = mode.applyVaultCoins("team1", 40, {
    reason: "pickup",
    actor: "a",
  });

  assert.equal(result.applied, 40);
  assert.equal(mode.getVaultCoins("team1"), before + 40);
  assert.equal(mode.getVaultCoins("team2"), before, "the other vault is untouched");

  const entry = room.modeState.coinEvents.at(-1);
  assert.equal(entry.reason, "pickup");
  assert.equal(entry.team, "team1");
  assert.equal(entry.delta, 40);
  assert.equal(entry.coins, before + 40);
});

test("a loose gold pickup moves coins from the map into the vault", () => {
  const room = roomFor();
  const mode = room.gameMode;
  const spawn = layout.randomGoldSpawnPoints[0];
  addPlayer(room, "raider", "team2", spawn.x, spawn.y);

  const before = mode.getVaultCoins("team2");
  const now = Date.now();
  room.modeState.randomGold.pickups = [
    { id: "g1", x: spawn.x, y: spawn.y, value: 25, radius: 42, spawnedAt: now - 5000 },
  ];
  mode._collectRandomGold(now);

  assert.equal(room.modeState.randomGold.pickups.length, 0);
  assert.equal(mode.getVaultCoins("team2"), before + 25);
});

test("a coin can be taken from its first floor touch, before it stops bouncing", () => {
  const room = roomFor();
  const mode = room.gameMode;
  const spawn = layout.randomGoldSpawnPoints[0];
  addPlayer(room, "camper", "team1", spawn.x, spawn.y);
  room.modeState.randomGold.spawnPoints = [spawn];
  const now = Date.now();
  room.modeState.randomGold.nextSpawnAt = now;
  mode._tickRandomGold(now);

  const pickup = room.modeState.randomGold.pickups[0];
  assert.ok(pickup.claimableMs > 0);
  assert.ok(pickup.claimableMs < pickup.arrivalMs, "collectable while still bouncing");
  const snapshot = mode.buildModeState().randomGoldPickups[0];
  assert.equal(snapshot.arrivalMs, pickup.arrivalMs, "the client animates to the same time");
  assert.equal(snapshot.claimableMs, pickup.claimableMs, "the client lands it at the same time");
  mode._collectRandomGold(now + pickup.claimableMs - 1);
  assert.equal(room.modeState.randomGold.pickups.length, 1, "still in the air");
  mode._collectRandomGold(now + pickup.claimableMs);
  assert.equal(room.modeState.randomGold.pickups.length, 0);
});

test("enemy damage strips exactly its own number of coins", () => {
  const room = roomFor();
  const mode = room.gameMode;
  const before = mode.getVaultCoins("team1");

  mode.damageVault("team1", 1200, { sourceTeam: "team2", sourcePlayer: "a" });
  assert.equal(mode.getVaultCoins("team1"), before - 1200);

  const afterBig = mode.getVaultCoins("team1");
  mode.damageVault("team1", 1, { sourceTeam: "team2", sourcePlayer: "a" });
  assert.equal(mode.getVaultCoins("team1"), afterBig - 1);

  const event = room.modeState.lastVaultDamageEvent;
  assert.equal(event.targetTeam, "team1");
  assert.equal(event.coins, mode.getVaultCoins("team1"));
});

test("damageVault reports the vault by its coins, which is what callers read", () => {
  const room = roomFor();
  const vault = room.gameMode.damageVault("team2", 1, {
    sourceTeam: "team1",
  });
  assert.equal(vault.coins, SETTINGS.vaultStartingCoins - 1);
  assert.equal(vault.health, undefined);
});

test("purchases are paid out of the vault and refused at the floor", () => {
  const room = roomFor();
  const mode = room.gameMode;
  const turret = layout.objects.find((o) => o.type === "claimableTurret");
  const buyer = addPlayer(room, "buyer", "team1", turret.x, turret.y);

  const before = mode.getVaultCoins("team1");
  const bought = mode.handlePlayerAction(buyer, { type: "mode-interact" });
  assert.equal(bought.shouldBroadcastSnapshot, true);
  assert.equal(mode.getVaultCoins("team1"), before - turret.claimCost);

  const object = room.modeState.objects.find((o) => o.id === turret.id);
  assert.equal(object.state.claimedByTeam, "team1");
  assert.equal(room.modeState.coinEvents.at(-1).reason, "purchase-turret");

  // Spent down to the floor, the next purchase is refused outright: a team
  // cannot buy its way into losing.
  const wall = layout.objects.find((o) => o.type === "wallSlot");
  const floor = room.modeState.purchaseFloorCoins;
  room.modeState.vaults.team1.coins = floor + wall.cost - 1;
  const builder = addPlayer(room, "builder", "team1", wall.x, wall.y);
  const refused = mode.handlePlayerAction(builder, { type: "mode-interact" });

  assert.equal(refused.shouldBroadcastSnapshot, false);
  assert.equal(mode.getVaultCoins("team1"), floor + wall.cost - 1);
  const wallObject = room.modeState.objects.find((o) => o.id === wall.id);
  assert.equal(wallObject.state.builtByTeam, null);

  // One more coin and the same purchase goes through.
  room.modeState.vaults.team1.coins = floor + wall.cost;
  assert.equal(
    mode.handlePlayerAction(builder, { type: "mode-interact" }).shouldBroadcastSnapshot,
    true,
  );
  assert.equal(mode.getVaultCoins("team1"), floor);
});

test("an emptied vault is destroyed and loses the match", () => {
  const room = roomFor();
  const mode = room.gameMode;
  mode.onStart();

  assert.equal(mode.evaluateVictoryState(), null);

  mode.damageVault("team2", SETTINGS.vaultStartingCoins, {
    sourceTeam: "team1",
  });

  assert.equal(mode.getVaultCoins("team2"), 0);
  assert.ok(room.modeState.vaults.team2.destroyedAt);
  assert.equal(room.modeState.phase, "finished");

  const outcome = mode.evaluateVictoryState();
  assert.equal(outcome.terminal, true);
  assert.equal(outcome.winnerTeam, "team1");
});

test("turret barrels match their bullets on acquisition, held aim and target changes", async () => {
  const { stepTurretAim } = await import("../src/client/game/modes/bankBust/turretMotion.mjs");
  for (const ownerTeam of ["team1", "team2"]) {
    const room = roomFor();
    const turret = room.modeState.objects.find((o) => o.type === "claimableTurret");
    room.modeState.objects = [turret];
    turret.state.claimedByTeam = ownerTeam;
    const enemy = addPlayer(room, "enemy", ownerTeam === "team1" ? "team2" : "team1", 0, 0);
    const motion = { angle: 0, facing: 0, phase: 0 };
    let now = 10000;
    // Holding one aim for many seconds must not put the barrel back into its
    // idle sweep. Large target changes must align on the first firing frame.
    for (const aim of [Math.PI, Math.PI, -Math.PI / 2, 0, Math.PI / 4, -Math.PI + 0.01]) {
      enemy.x = turret.x + Math.cos(aim) * 150;
      enemy.y = turret.y + Math.sin(aim) * 150;
      room.gameMode._tickClaimedTurrets(now);
      const snapshot = room.gameMode.buildModeState();
      const shot = snapshot.turretProjectiles.at(-1);
      assert.equal(shot.spawnedAt, now, "a fresh shot was fired");
      const renderAngle = stepTurretAim(motion, snapshot.objects[0].state.aimAngle, ownerTeam, now, 1 / 60);
      const speed = Math.hypot(shot.vx, shot.vy);
      assert.ok(Math.abs(-Math.cos(renderAngle) - shot.vx / speed) < 1e-10);
      assert.ok(Math.abs(-Math.sin(renderAngle) - shot.vy / speed) < 1e-10);
      const heldAngle = stepTurretAim(motion, snapshot.objects[0].state.aimAngle, ownerTeam, now + 4000, 1 / 60);
      assert.equal(heldAngle, renderAngle, "stationary aim never expires");
      now += Math.max(5000, turret.state.fireRateMs);
    }
  }
});

test("a bust holds the finish open long enough for clients to see the vault at zero", () => {
  const room = roomFor();
  const mode = room.gameMode;
  mode.onStart();

  mode.damageVault("team2", SETTINGS.vaultStartingCoins, { sourceTeam: "team1" });

  assert.ok(mode.evaluateVictoryState().meta.finishDelayMs > 0);
});

test("the match keeps running through a bust, then finishes for the winner", () => {
  const { checkVictoryCondition } = require("../src/server/core/gameRoom/lifecycleManager");
  const room = roomFor();
  room.status = "active";
  const finished = [];
  room._finishGame = (winner) => finished.push(winner);
  room.gameMode.onStart();

  room.gameMode.damageVault("team2", SETTINGS.vaultStartingCoins, { sourceTeam: "team1" });
  checkVictoryCondition(room);
  assert.deepEqual(finished, [], "the snapshot showing the vault at zero still has to go out");

  // A later hit must not restart the wait or change who it is for.
  const pending = room._pendingVictoryFinishTimeout;
  checkVictoryCondition(room);
  assert.equal(room._pendingVictoryFinishTimeout, pending);
  clearTimeout(pending);
});

test("the result cannot change while a bust plays out", () => {
  const room = roomFor();
  const mode = room.gameMode;
  mode.onStart();

  mode.damageVault("team2", SETTINGS.vaultStartingCoins, { sourceTeam: "team1" });
  const winnerCoins = mode.getVaultCoins("team1");
  mode.damageVault("team1", SETTINGS.vaultStartingCoins, { sourceTeam: "team2" });

  assert.equal(mode.getVaultCoins("team1"), winnerCoins);
  assert.equal(mode.evaluateVictoryState().winnerTeam, "team1");
  assert.equal(mode.applyVaultCoins("team1", 500, { reason: "pickup" }), null);
});

test("on the clock, the vault with more coins left wins", () => {
  const room = roomFor();
  const mode = room.gameMode;
  mode.onStart();
  mode.applyVaultCoins("team1", 120, { reason: "pickup" });

  const outcome = mode.onTimerExpired();
  assert.equal(outcome.winnerTeam, "team1");
  assert.equal(outcome.meta.tiebreakReason, "vault-coins");
  assert.equal(outcome.meta.team1VaultCoins, SETTINGS.vaultStartingCoins + 120);
  assert.equal(outcome.meta.team2VaultCoins, SETTINGS.vaultStartingCoins);

  const drawn = roomFor();
  drawn.gameMode.onStart();
  assert.equal(drawn.gameMode.onTimerExpired().winnerTeam, null);
});

function dropCrate(mode, room) {
  mode.onStart();
  const spawnAt = room.modeState.centerGold.spawnAt;
  mode._tickCenterGold(spawnAt);
  return spawnAt;
}

function hitFor(room, attacker, target) {
  return handleHit(room, attacker.name, {
    attacker: attacker.name,
    target,
    attackType: "basic",
    instanceId: `swing-${room._swing = (room._swing || 0) + 1}`,
  }, { server: true });
}

function fighter(room, name, team, x, y) {
  const player = addPlayer(room, name, team, x, y);
  player.char_class = "thorg";
  player.baseDamage = 2500;
  return player;
}

function combatRoom() {
  const room = roomFor();
  room._recordCombatStat = () => {};
  room.broadcastSnapshot = () => {};
  room._getAttackMaxDist = () => 200;
  room._getHistoricalPosition = (p) => ({ x: p.x, y: p.y });
  room._checkVictoryCondition = () => {};
  return room;
}

test("the centre crate is announced before it lands and cannot be walked into", () => {
  const room = roomFor();
  const mode = room.gameMode;
  mode.onStart();

  const site = room.modeState.centerGold;
  assert.equal(site.enabled, true);
  assert.equal(site.phase, "scheduled");
  assert.ok(site.announceAt < site.spawnAt, "the warning comes first");
  assert.equal(mode.getCenterCrate(), null, "nothing to hit before it lands");

  // Still only announced while the lead time runs.
  mode._tickCenterGold(site.announceAt + 1);
  assert.equal(site.phase, "announced");

  const spawnAt = site.spawnAt;
  mode._tickCenterGold(spawnAt);
  assert.equal(site.phase, "active");
  assert.equal(site.round, 1);
  assert.equal(mode.getCenterCrate().health, site.maxHealth);

  // Standing on it does nothing: it has to be damaged open.
  const before = mode.getVaultCoins("team2");
  addPlayer(room, "runner", "team2", site.x, site.y);
  mode._tickCenterGold(spawnAt + 100);
  assert.equal(site.phase, "active");
  assert.equal(mode.getVaultCoins("team2"), before);
});

test("damage breaks the crate, and its coins spill out for anyone to take", () => {
  const room = roomFor();
  const mode = room.gameMode;
  const spawnAt = dropCrate(mode, room);
  const site = room.modeState.centerGold;

  const firstHit = Math.floor(site.maxHealth / 2);
  assert.equal(mode.damageCenterCrate(firstHit, { sourceTeam: "team1", x: site.x - 80 }), firstHit);
  assert.equal(site.health, site.maxHealth - firstHit);
  assert.equal(site.lastHit.x, site.x - 80, "the snapshot says which side it was hit from");
  assert.equal(room.modeState.randomGold.pickups.length, 0, "still shut");

  // Overkill is clamped to what the crate had left.
  const left = site.health;
  assert.equal(mode.damageCenterCrate(left * 3, { sourceTeam: "team1", sourcePlayer: "a" }), left);
  assert.equal(site.lastOutcome, "broken");
  assert.equal(site.lastBreak.team, "team1");
  assert.equal(site.phase, "scheduled", "another one is queued");
  assert.ok(site.spawnAt > spawnAt);
  assert.equal(mode.damageCenterCrate(100), 0, "a broken crate takes no more damage");

  // Nobody is paid by the break itself; the piles add up to the whole reward.
  assert.equal(mode.getVaultCoins("team1"), SETTINGS.vaultStartingCoins);
  const piles = room.modeState.randomGold.pickups;
  assert.ok(piles.length > 1);
  assert.equal(piles.reduce((sum, pile) => sum + pile.value, 0), site.reward);
  assert.equal(new Set(piles.map((pile) => pile.id)).size, piles.length);

  // Either team can take them, through the same ledger as other gold.
  const pile = piles[0];
  addPlayer(room, "thief", "team2", pile.x, pile.y);
  mode._collectRandomGold(pile.spawnedAt + 5000);
  assert.equal(mode.getVaultCoins("team2"), SETTINGS.vaultStartingCoins + pile.value);
  assert.equal(room.modeState.coinEvents.at(-1).reason, "centerGold");
});

test("a real hit damages the crate from either team and costs no vault coins", () => {
  const room = combatRoom();
  const mode = room.gameMode;
  dropCrate(mode, room);
  const site = room.modeState.centerGold;

  for (const [name, team] of [["blue", "team1"], ["red", "team2"]]) {
    const attacker = fighter(room, name, team, site.x + 60, site.y);
    const before = site.health;
    const outcome = hitFor(room, attacker, CENTER_CRATE_TARGET);
    assert.equal(outcome.accepted, true);
    assert.equal(site.health, before - outcome.appliedDamage);
    assert.ok(outcome.appliedDamage > 0);
  }
  assert.equal(mode.getVaultCoins("team1"), SETTINGS.vaultStartingCoins);
  assert.equal(mode.getVaultCoins("team2"), SETTINGS.vaultStartingCoins);

  // Out of range is refused like any other target.
  const before = site.health;
  const far = fighter(room, "far", "team1", site.x + 2000, site.y);
  assert.equal(hitFor(room, far, CENTER_CRATE_TARGET), undefined);
  assert.equal(site.health, before);
});

test("hits on a crate that is not out yet are ignored", () => {
  const room = combatRoom();
  room.gameMode.onStart();
  const site = room.modeState.centerGold;
  const attacker = fighter(room, "early", "team1", site.x, site.y);
  assert.equal(hitFor(room, attacker, CENTER_CRATE_TARGET), undefined);
});

test("attack runtimes treat the crate as a target until it breaks", () => {
  const room = roomFor();
  const mode = room.gameMode;
  const attacker = addPlayer(room, "a", "team1", 0, 0);
  assert.equal(getObjectiveTargets(room, attacker).some((t) => t.targetName === CENTER_CRATE_TARGET), false);

  dropCrate(mode, room);
  const site = room.modeState.centerGold;
  const crate = getObjectiveTargets(room, attacker).find((t) => t.targetName === CENTER_CRATE_TARGET);
  assert.ok(crate.bounds.left < site.x && crate.bounds.right > site.x);
  assert.ok(crate.bounds.top < site.y && crate.bounds.bottom > site.y);

  mode.damageCenterCrate(site.maxHealth);
  assert.equal(getObjectiveTargets(room, attacker).some((t) => t.targetName === CENTER_CRATE_TARGET), false);
});

test("an attack's own hitbox reaches the crate and vault damage is unaffected", () => {
  const room = combatRoom();
  room.handleHit = (attackerId, payload, options) => handleHit(room, attackerId, payload, options);
  dropCrate(room.gameMode, room);
  const site = room.modeState.centerGold;
  const attacker = fighter(room, "swinger", "team1", site.x - 90, site.y);
  const attack = {
    attackerParticipantId: "swinger",
    attackerName: "swinger",
    attackType: "basic",
    instanceId: "real-swing",
    hitSet: new Set(),
  };
  // One swing only hits it once, however long its hitbox stays on the crate.
  hitCircleTargets(room, attack, null, site.x - 40, site.y, 30, Date.now());
  const afterFirst = site.health;
  assert.ok(afterFirst < site.maxHealth);
  hitCircleTargets(room, attack, null, site.x - 40, site.y, 30, Date.now());
  assert.equal(site.health, afterFirst);
  assert.equal(room.gameMode.getVaultCoins("team2"), SETTINGS.vaultStartingCoins);
});

test("the crate expires on its own and is not scheduled past the clock", () => {
  const room = roomFor();
  const mode = room.gameMode;
  const spawnAt = dropCrate(mode, room);

  const expiresAt = room.modeState.centerGold.expiresAt;
  assert.ok(expiresAt > spawnAt);

  mode._tickCenterGold(expiresAt);
  assert.equal(room.modeState.centerGold.lastOutcome, "expired");
  assert.equal(room.modeState.randomGold.pickups.length, 0, "an expired crate spills nothing");
  assert.equal(mode.getVaultCoins("team1"), SETTINGS.vaultStartingCoins);

  // With the match nearly over there is no time for another one.
  room.modeState.endsAt = Date.now() + 1000;
  mode._resolveCenterGold(Date.now(), "expired");
  assert.equal(room.modeState.centerGold.phase, "done");
  assert.equal(room.modeState.centerGold.spawnAt, null);
});

test("a destroyed vault stops moving: no late gains, no late losses", () => {
  const room = roomFor();
  const mode = room.gameMode;
  mode.damageVault("team1", SETTINGS.vaultStartingCoins, {
    sourceTeam: "team2",
  });
  assert.equal(mode.getVaultCoins("team1"), 0);

  assert.equal(mode.applyVaultCoins("team1", 500, { reason: "pickup" }), null);
  assert.equal(mode.getVaultCoins("team1"), 0);
  mode.damageVault("team1", 9999, { sourceTeam: "team2" });
  assert.equal(mode.getVaultCoins("team1"), 0);
});

test('purchases cannot destroy a vault even when the map purchase floor is zero', () => {
  const room = roomFor();
  room.modeState.purchaseFloorCoins = 0;
  const vault = room.modeState.vaults.team1;
  const before = vault.coins;
  assert.equal(room.gameMode.spendVaultCoins('team1', before, { reason: 'purchase-wall' }), false);
  assert.equal(vault.coins, before);
  assert.equal(vault.destroyedAt, null);
  assert.equal(room.gameMode.spendVaultCoins('team1', before + 1, { reason: 'purchase-wall' }), false);
  assert.equal(room.gameMode.canAffordPurchase('team1', NaN), false);
  room.modeState.phase = 'finished';
  assert.equal(room.gameMode.spendVaultCoins('team1', 1), false);
  assert.equal(vault.coins, before);
});
