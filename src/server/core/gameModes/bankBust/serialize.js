const { BANK_BUST_VAULT_DEFAULT_WIDTH, BANK_BUST_VAULT_DEFAULT_HEIGHT, BANK_BUST_VAULT_DEFAULT_RADIUS } = require("../../../../shared/bankBustSettings.js");
const { CENTER_GOLD_RADIUS, COIN_EVENT_SNAPSHOT_LIMIT, serializeModeObject, serializeRandomGoldPickup } = require("./state");
const { TURRET_PROJECTILE_RADIUS } = require("./modeRules");

function serializeVault(mode, team, layout, settings) {
  const vault = mode.getModeState()?.vaults?.[team] || null;
  const layoutVault = layout?.vaults?.[team] || {};
  const startingCoins = Math.max(
    1,
    Number(vault?.startingCoins) || settings.vaultStartingCoins,
  );
  return {
    team,
    coins: Math.max(0, Number(vault?.coins ?? startingCoins)),
    startingCoins,
    destroyedAt: vault?.destroyedAt || null,
    x: vault?.x ?? (Number(layoutVault?.x) || 0),
    y: vault?.y ?? (Number(layoutVault?.y) || 0),
    width: vault?.width ?? (Number(layoutVault?.width) || BANK_BUST_VAULT_DEFAULT_WIDTH),
    height: vault?.height ?? (Number(layoutVault?.height) || BANK_BUST_VAULT_DEFAULT_HEIGHT),
    radius: vault?.radius ?? (Number(layoutVault?.radius) || BANK_BUST_VAULT_DEFAULT_RADIUS),
    label:
      vault?.label ||
      layoutVault?.label ||
      (team === "team1" ? "Blue Vault" : "Red Vault"),
  };
}

function serializeCenterGold(mode) {
  const site = mode.getModeState()?.centerGold || null;
  if (!site?.enabled) return null;
  return {
    enabled: true,
    phase: site.phase || "idle",
    round: Number(site.round) || 0,
    x: Number(site.x) || 0,
    y: Number(site.y) || 0,
    radius: Math.max(24, Number(site.radius) || CENTER_GOLD_RADIUS),
    width: Number(site.width) || 0,
    height: Number(site.height) || 0,
    reward: Math.max(1, Number(site.reward) || 0),
    health: Math.max(0, Number(site.health) || 0),
    maxHealth: Math.max(1, Number(site.maxHealth) || 1),
    lastHit: site.lastHit || null,
    announceAt: site.announceAt || null,
    spawnAt: site.spawnAt || null,
    expiresAt: site.expiresAt || null,
    lastOutcome: site.lastOutcome || null,
    lastBreak: site.lastBreak || null,
  };
}

function buildModeState(mode) {
  const state = mode.getModeState();
  const layout = mode.getLayout();
  const settings = mode.getSettings();
  return {
    type: "bank-bust",
    topology: "team-vs-team",
    phase: state?.phase || "setup",
    objectiveLabel: "Drain the enemy vault",
    matchDurationMs:
      Number(state?.matchDurationMs) || settings.matchDurationMs,
    startedAt: state?.startedAt || null,
    endsAt: state?.endsAt || null,
    respawns: true,
    respawnDelayMs: state?.respawnDelayMs ?? settings.respawnDelayMs,
    respawnShieldMs: 0,
    // The only spendable number in the mode is each vault's own coins.
    purchaseFloorCoins: state?.purchaseFloorCoins ?? settings.purchaseFloorCoins,
    lowCoinsRatio: state?.lowCoinsRatio ?? settings.lowCoinsRatio,
    objects: Array.isArray(state?.objects)
      ? state.objects.map((entry) => serializeModeObject(entry))
      : [],
    randomGoldSpawnPoints: Array.isArray(state?.randomGold?.spawnPoints)
      ? state.randomGold.spawnPoints.map((entry) => ({
          id: entry.id,
          x: Number(entry.x) || 0,
          y: Number(entry.y) || 0,
        }))
      : [],
    randomGoldPickups: Array.isArray(state?.randomGold?.pickups)
      ? state.randomGold.pickups.map((entry) =>
          serializeRandomGoldPickup(entry),
        )
      : [],
    turretProjectiles: Array.isArray(state?.turretProjectiles)
      ? state.turretProjectiles.map((entry) => ({
          id: entry.id,
          ownerTeam: entry.ownerTeam || null,
          sourceId: entry.sourceId || null,
          x: Number(entry.x) || 0,
          y: Number(entry.y) || 0,
          vx: Number(entry.vx) || 0,
          vy: Number(entry.vy) || 0,
          angle: Math.atan2(Number(entry.vy) || 0, Number(entry.vx) || 0),
          radius: Math.max(
            8,
            Number(entry.radius) || TURRET_PROJECTILE_RADIUS,
          ),
          spawnedAt: Number(entry.spawnedAt) || null,
          lastUpdatedAt: Number(entry.lastUpdatedAt) || null,
        }))
      : [],
    coinEvents: Array.isArray(state?.coinEvents)
      ? state.coinEvents.slice(-COIN_EVENT_SNAPSHOT_LIMIT)
      : [],
    centerGold: mode._serializeCenterGold(),
    vaults: {
      team1: mode._serializeVault("team1", layout, settings),
      team2: mode._serializeVault("team2", layout, settings),
    },
    respawnPoints: {
      team1: layout?.respawnPoints?.team1 || null,
      team2: layout?.respawnPoints?.team2 || null,
    },
    lastVaultDamageEvent: state?.lastVaultDamageEvent || null,
    recentAlerts: Array.isArray(state?.recentAlerts)
      ? state.recentAlerts.slice()
      : [],
  };
}

module.exports = { serializeVault, serializeCenterGold, buildModeState };
