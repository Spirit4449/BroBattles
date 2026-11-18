const { PICKUP_DELAY_MS } = require("../../../../shared/powerups");
const { RANDOM_GOLD_PICKUP_CAP, RANDOM_GOLD_PICKUP_VALUE, RANDOM_GOLD_PICKUP_RADIUS, RANDOM_GOLD_SPAWN_INTERVAL_MS, RANDOM_GOLD_ARRIVE_MS, RANDOM_GOLD_CLAIMABLE_MS } = require("./state");
const { distance } = require("./modeRules");

function tickGoldMines(mode, now) {
  const state = mode.getModeState();
  for (const entry of Array.isArray(state?.objects) ? state.objects : []) {
    if (entry?.type !== "goldMine") continue;
    const mine = entry.state || {};
    if (!mine.yieldIntervalMs || !mine.yieldAmount) continue;
    const elapsed = now - (Number(mine.lastGeneratedAt) || now);
    if (elapsed < mine.yieldIntervalMs) continue;
    const steps = Math.max(1, Math.floor(elapsed / mine.yieldIntervalMs));
    mine.storedGold = Math.min(
      Number(mine.maxStoredGold) || 60,
      (Number(mine.storedGold) || 0) +
        steps * (Number(mine.yieldAmount) || 0),
    );
    mode.stateVersion++;
    mine.lastGeneratedAt = now;
  }
}

function tickRandomGold(mode, now) {
  const state = mode.getModeState();
  const randomGold = state?.randomGold;
  if (!randomGold) return;
  if (!Array.isArray(randomGold.pickups)) randomGold.pickups = [];
  if (
    !Array.isArray(randomGold.spawnPoints) ||
    !randomGold.spawnPoints.length
  ) {
    return;
  }
  if (randomGold.pickups.length >= RANDOM_GOLD_PICKUP_CAP) return;
  if (now < (Number(randomGold.nextSpawnAt) || 0)) return;

  const spawnPoint =
    randomGold.spawnPoints[
      randomGold.nextSpawnIdx % randomGold.spawnPoints.length
    ] || null;
  randomGold.nextSpawnIdx = (Number(randomGold.nextSpawnIdx) || 0) + 1;
  randomGold.nextSpawnAt = now + RANDOM_GOLD_SPAWN_INTERVAL_MS;
  if (!spawnPoint) return;

  mode.stateVersion++;
  randomGold.pickups.push({
    id: `rand-gold-${now}-${randomGold.nextSpawnIdx}`,
    x: Number(spawnPoint.x) || 0,
    y: Number(spawnPoint.y) || 0,
    value: RANDOM_GOLD_PICKUP_VALUE,
    radius: RANDOM_GOLD_PICKUP_RADIUS,
    spawnedAt: now,
    arrivalMs: RANDOM_GOLD_ARRIVE_MS,
    claimableMs: RANDOM_GOLD_CLAIMABLE_MS,
  });
}

function collectMineGold(mode, now, players = mode._eligiblePlayers()) {
  const state = mode.getModeState();
  for (const entry of Array.isArray(state?.objects) ? state.objects : []) {
    if (entry?.type !== "goldMine") continue;
    const mine = entry.state || {};
    const storedGold = Math.max(0, Number(mine.storedGold) || 0);
    if (storedGold <= 0) continue;
    for (const player of players) {
      const dist = distance(player.x, player.y, entry.x, entry.y);
      if (dist > (Number(mine.collectionRadius) || 110)) continue;
      mode.stateVersion++;
      mine.storedGold = 0;
      mode.applyVaultCoins(player.team, storedGold, {
        reason: "mine",
        source: entry.id,
        actor: player.name,
        actorTeam: player.team,
        x: entry.x,
        y: entry.y,
        at: now,
      });
      break;
    }
  }
}

function collectRandomGold(mode, now, players = mode._eligiblePlayers()) {
  const state = mode.getModeState();
  const randomGold = state?.randomGold;
  if (!randomGold?.pickups?.length) return;
  const remaining = [];
  for (const pickup of randomGold.pickups) {
    // Collectable from the coin's first floor touch, while it still bounces.
    const delay = Math.max(
      PICKUP_DELAY_MS,
      Number(pickup.claimableMs || pickup.arrivalMs) || 0,
    );
    if (now < Number(pickup.spawnedAt ?? 0) + delay) {
      remaining.push(pickup);
      continue;
    }
    let collected = false;
    for (const player of players) {
      const dist = distance(player.x, player.y, pickup.x, pickup.y);
      if (dist > (Number(pickup.radius) || RANDOM_GOLD_PICKUP_RADIUS))
        continue;
      mode.applyVaultCoins(player.team, pickup.value, {
        reason: pickup.reason || "pickup",
        source: pickup.id,
        actor: player.name,
        actorTeam: player.team,
        x: pickup.x,
        y: pickup.y,
        at: now,
      });
      collected = true;
      break;
    }
    if (!collected) remaining.push(pickup);
  }
  if (remaining.length !== randomGold.pickups.length) {
    mode.stateVersion++;
    randomGold.pickups = remaining;
  }
}

function onDeathDropCollected(mode, playerData, drop) {
  if (!playerData || !drop || drop.type !== "coin") return null;
  const amount = Math.max(1, Number(drop.value) || 1) * mode.getSettings().deathDropVaultCoins;
  mode.applyVaultCoins(playerData.team, amount, {
    reason: "deathDrop",
    source: drop.id,
    actor: playerData.name,
    actorTeam: playerData.team,
    x: Number(drop.x) || Number(playerData.x) || 0,
    y: Number(drop.y) || Number(playerData.y) || 0,
  });
  return { suppressDefaultReward: true };
}

module.exports = { tickGoldMines, tickRandomGold, collectMineGold, collectRandomGold, onDeathDropCollected };
