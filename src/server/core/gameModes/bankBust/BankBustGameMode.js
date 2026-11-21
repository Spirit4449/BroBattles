const vaults = require("./vaults");
const centerGold = require("./centerGold");
const turrets = require("./turrets");
const goldPickups = require("./goldPickups");
const victory = require("./victory");
const serialize = require("./serialize");
const { DEFAULT_SETTINGS, distance } = require("./modeRules");

const { BaseGameMode } = require("../BaseGameMode");
const { resolveBankBustSettings, BANK_BUST_VAULT_DEFAULT_WIDTH, BANK_BUST_VAULT_DEFAULT_HEIGHT, BANK_BUST_VAULT_DEFAULT_RADIUS } = require("../../../../shared/bankBustSettings");

const { RANDOM_GOLD_SPAWN_INTERVAL_MS, CENTER_GOLD_FIRST_SPAWN_MS, CENTER_GOLD_ANNOUNCE_LEAD_MS, createBankBustObjects, createRandomGoldState, createCenterGoldState, expireCoinEvents } = require("./state");

// Vault-under-attack alerts stay in the snapshot this long.
const ALERT_RETENTION_MS = 2200;

function buildVaultState(
  team,
  layoutVault = null,
  startingCoins = DEFAULT_SETTINGS.vaultStartingCoins,
) {
  const start = Math.max(1, Math.round(Number(startingCoins) || 0));
  return {
    team,
    label:
      String(layoutVault?.label || "").trim() ||
      (team === "team1" ? "Blue Vault" : "Red Vault"),
    // The one value this mode is about.
    coins: start,
    // Only a reference for the bar and the low-coins warning; it is never a
    // cap and never a second pool.
    startingCoins: start,
    destroyedAt: null,
    x: Number(layoutVault?.x) || 0,
    y: Number(layoutVault?.y) || 0,
    radius: Math.max(30, Number(layoutVault?.radius) || BANK_BUST_VAULT_DEFAULT_RADIUS),
    width: Math.max(50, Number(layoutVault?.width) || BANK_BUST_VAULT_DEFAULT_WIDTH),
    height: Math.max(50, Number(layoutVault?.height) || BANK_BUST_VAULT_DEFAULT_HEIGHT),
  };
}

class BankBustGameMode extends BaseGameMode {
  constructor(room, descriptor) {
    super(room, descriptor);
    this.stateVersion = 0;
    this.movementBlockers = null;
    this.settings = Object.freeze(resolveBankBustSettings(this.descriptor.settings));
  }

  getSettings() {
    return this.settings;
  }

  getLayout() {
    return this.room?.mapSnapshot?.map?.objectiveLayout?.bankBust || null;
  }

  getMatchDurationMs() {
    return this.getSettings().matchDurationMs;
  }

  supportsSuddenDeath() {
    return false;
  }

  createRoomState() {
    const settings = this.getSettings();
    const layout = this.getLayout();
    return {
      type: "bank-bust",
      phase: "setup",
      startedAt: null,
      endsAt: null,
      matchDurationMs: settings.matchDurationMs,
      respawnDelayMs: settings.respawnDelayMs,
      purchaseFloorCoins: settings.purchaseFloorCoins,
      lowCoinsRatio: settings.lowCoinsRatio,
      objects: createBankBustObjects(layout),
      randomGold: createRandomGoldState(layout),
      centerGold: createCenterGoldState(layout),
      // One ledger for every coin movement in the match, in both directions.
      coinEvents: [],
      turretProjectiles: [],
      lastProjectileTickAt: Date.now(),
      vaults: {
        team1: buildVaultState(
          "team1",
          layout?.vaults?.team1,
          settings.vaultStartingCoins,
        ),
        team2: buildVaultState(
          "team2",
          layout?.vaults?.team2,
          settings.vaultStartingCoins,
        ),
      },
      lastVaultDamageEvent: null,
      recentAlerts: [],
    };
  }

  onStart() {
    const state = this.getModeState();
    if (!state) return;
    const now = Date.now();
    this.stateVersion++;
    state.phase = "active";
    state.startedAt = now;
    state.endsAt = now + this.getMatchDurationMs();
    state.randomGold.nextSpawnAt = now + RANDOM_GOLD_SPAWN_INTERVAL_MS;
    if (state.centerGold?.enabled) {
      const spawnAt = now + CENTER_GOLD_FIRST_SPAWN_MS;
      state.centerGold.spawnAt = spawnAt;
      state.centerGold.announceAt = spawnAt - CENTER_GOLD_ANNOUNCE_LEAD_MS;
      state.centerGold.phase = "scheduled";
    }
  }

  getRespawnPlan(playerData) {
    const { getDuelGeometry, spawnForParticipant } = require('../../../../shared/physics/duelGeometry');
    const geometry = this.room?.geometry || getDuelGeometry(this.room?.matchData?.map);
    const state = this.getModeState();
    const layout = this.getLayout();
    const respawn = layout?.respawnPoints?.[playerData?.team] || null;
    return {
      enabled: true,
      delayMs: state?.respawnDelayMs ?? DEFAULT_SETTINGS.respawnDelayMs,
      spawn: "team-base",
      team: playerData?.team || null,
      position: geometry ? (this.room?.spawnStateFor?.(playerData) ||
        spawnForParticipant(geometry, playerData, Number(playerData.spawnIndex) || 0)) : respawn
        ? { x: Number(respawn.x) || 0, y: Number(respawn.y) || 0 }
        : null,
    };
  }

  // Built walls stop every player, the builder's team included.
  getMovementBlockers() {
    return (this.movementBlockers ||= this.getShotBlockers(null));
  }

  // Built walls stop the other team's shots. The builder's own team shoots
  // through them, though it cannot walk through them.
  getShotBlockers(shooterTeam) {
    const blockers = [];
    for (const entry of this.getModeState()?.objects || []) {
      const owner = entry?.type === "wallSlot" ? entry.state?.builtByTeam : null;
      if (!owner || owner === shooterTeam) continue;
      const halfW = entry.state.width / 2;
      const halfH = entry.state.height / 2;
      blockers.push({
        id: entry.id,
        left: entry.x - halfW,
        right: entry.x + halfW,
        top: entry.y - halfH,
        bottom: entry.y + halfH,
        collision: { up: true, down: true, left: true, right: true },
      });
    }
    return blockers;
  }

  getVaultState(targetTeam) {
    return vaults.getVaultState(this, targetTeam);
  }

  getBotObjective(playerData) {
    const team = playerData?.team || null;
    const targetTeam =
      team === "team1" ? "team2" : team === "team2" ? "team1" : null;
    const vault = targetTeam ? this.getVaultState(targetTeam) : null;
    return {
      ...super.getBotObjective(playerData),
      team,
      targetTeam,
      target: vault
        ? {
            id: `${targetTeam}-vault`,
            type: "vault",
            team: targetTeam,
            x: vault.x,
            y: vault.y,
          }
        : null,
      goal: vault ? { x: vault.x, y: vault.y } : null,
      interaction: "damage",
    };
  }

  getVaultCoins(team) {
    return vaults.getVaultCoins(this, team);
  }

  // Every coin movement in the mode goes through here: pickups, mine hauls,
  // death drops, centre gold, enemy damage and purchases. It owns the number,
  // clamps it and writes the ledger entry the client renders from.
  applyVaultCoins(team, delta, meta = {}) {
    return vaults.applyVaultCoins(this, team, delta, meta);
  }

  // Purchases are paid out of the vault, but never far enough to hand the
  // other team a win: the floor is the last thing a team can spend down to.
  canAffordPurchase(team, cost) {
    return vaults.canAffordPurchase(this, team, cost);
  }

  spendVaultCoins(team, cost, meta = {}) {
    return vaults.spendVaultCoins(this, team, cost, meta);
  }

  _findNearestInteractable(playerData) {
    const state = this.getModeState();
    const px = Number(playerData?.x) || 0;
    const py = Number(playerData?.y) || 0;
    let best = null;
    for (const entry of Array.isArray(state?.objects) ? state.objects : []) {
      if (entry?.type !== "claimableTurret" && entry?.type !== "wallSlot")
        continue;
      const radius =
        entry?.type === "claimableTurret"
          ? entry.state.claimRadius
          : entry.state.buildRadius;
      const dist = distance(px, py, entry.x, entry.y);
      if (dist > radius) continue;
      if (!best || dist < best.dist) best = { entry, dist };
    }
    return best?.entry || null;
  }

  handlePlayerAction(playerData, actionData = {}) {
    if (String(actionData?.type) !== "mode-interact") {
      return { handled: false };
    }
    const target = this._findNearestInteractable(playerData);
    if (!target) return { handled: true, shouldBroadcastSnapshot: false };

    if (target.type === "claimableTurret") {
      if (target?.state?.claimedByTeam === playerData.team) {
        return { handled: true, shouldBroadcastSnapshot: false };
      }
      const cost = Math.max(0, Number(target?.state?.claimCost) || 0);
      if (
        !this.spendVaultCoins(playerData.team, cost, {
          reason: "purchase-turret",
          source: target.id,
          actor: playerData.name,
          actorTeam: playerData.team,
          x: target.x,
          y: target.y,
        })
      ) {
        return { handled: true, shouldBroadcastSnapshot: false };
      }
      this.stateVersion++;
      target.state.claimedByTeam = playerData.team;
      target.teamOwner = playerData.team;
      target.state.lastPurchasedAt = Date.now();
      target.state.lastPurchasedBy = playerData.name;
      return { handled: true, shouldBroadcastSnapshot: true };
    }

    if (target.type === "wallSlot") {
      if (target?.state?.builtByTeam) {
        return { handled: true, shouldBroadcastSnapshot: false };
      }
      const cost = Math.max(0, Number(target?.state?.cost) || 0);
      if (
        !this.spendVaultCoins(playerData.team, cost, {
          reason: "purchase-wall",
          source: target.id,
          actor: playerData.name,
          actorTeam: playerData.team,
          x: target.x,
          y: target.y,
        })
      ) {
        return { handled: true, shouldBroadcastSnapshot: false };
      }
      this.stateVersion++;
      this.movementBlockers = null;
      target.state.builtByTeam = playerData.team;
      target.teamOwner = playerData.team;
      target.state.builtAt = Date.now();
      target.state.builtBy = playerData.name;
      return { handled: true, shouldBroadcastSnapshot: true };
    }

    return { handled: false };
  }

  tick(now = Date.now()) {
    const state = this.getModeState();
    if (!state) return;

    const recentAlerts = state.recentAlerts;
    if (recentAlerts.some(alert => now - alert.at > ALERT_RETENTION_MS)) {
      state.recentAlerts = recentAlerts.filter(alert => now - alert.at <= ALERT_RETENTION_MS);
      this.stateVersion++;
    }
    const events = expireCoinEvents(state.coinEvents, now);
    if (events !== state.coinEvents) {
      state.coinEvents = events;
      this.stateVersion++;
    }
    const players = this._eligiblePlayers();
    this._tickGoldMines(now);
    this._tickRandomGold(now);
    this._tickCenterGold(now);
    this._collectMineGold(now, players);
    this._collectRandomGold(now, players);
    this._tickTurretProjectiles(now, players);
    this._tickClaimedTurrets(now, players);
  }

  // The contested centre crate. It runs on a fixed announce -> spawn -> expire
  // cycle at one visible spot, so both teams can commit to the fight in advance
  // and no single drop decides the match.
  _tickCenterGold(now) {
    return centerGold.tickCenterGold(this, now);
  }

  // The crate while it can be hit, or null. Attack runtimes test this exactly
  // as they test a vault; either team may damage it.
  getCenterCrate() {
    return centerGold.getCenterCrate(this);
  }

  damageCenterCrate(rawDamage, meta = {}) {
    return centerGold.damageCenterCrate(this, rawDamage, meta);
  }

  _spillCenterCrate(site, now) {
    return centerGold.spillCenterCrate(this, site, now);
  }

  _resolveCenterGold(now, outcome) {
    return centerGold.resolveCenterGold(this, now, outcome);
  }

  _tickClaimedTurrets(now, players) {
    return turrets.tickClaimedTurrets(this, now, players);
  }

  _tickTurretProjectiles(now, players) {
    return turrets.tickTurretProjectiles(this, now, players);
  }

  _tickGoldMines(now) {
    return goldPickups.tickGoldMines(this, now);
  }

  _tickRandomGold(now) {
    return goldPickups.tickRandomGold(this, now);
  }

  _eligiblePlayers() {
    return Array.from(this.room?.players?.values?.() || []).filter(
      (player) =>
        player &&
        player.isAlive &&
        player.connected !== false &&
        player.loaded === true &&
        (player.team === "team1" || player.team === "team2"),
    );
  }

  _collectMineGold(now, players) {
    return goldPickups.collectMineGold(this, now, players);
  }

  _collectRandomGold(now, players) {
    return goldPickups.collectRandomGold(this, now, players);
  }

  onDeathDropCollected(playerData, drop) {
    return goldPickups.onDeathDropCollected(this, playerData, drop);
  }

  damageVault(targetTeam, rawDamage, meta = {}) {
    return vaults.damageVault(this, targetTeam, rawDamage, meta);
  }

  evaluateVictoryState() {
    return victory.evaluateVictoryState(this);
  }

  onTimerExpired() {
    return victory.onTimerExpired(this);
  }

  _serializeVault(team, layout, settings) {
    return serialize.serializeVault(this, team, layout, settings);
  }

  _serializeCenterGold() {
    return serialize.serializeCenterGold(this);
  }

  buildModeState() {
    return serialize.buildModeState(this);
  }
}

module.exports = { BankBustGameMode };
