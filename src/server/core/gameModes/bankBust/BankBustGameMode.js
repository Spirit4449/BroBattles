const { BaseGameMode } = require("../BaseGameMode");
const {
  getMapObjectiveLayout,
} = require("../../../helpers/gameSelectionCatalog");
const effectManager = require("../../gameRoom/effects/effectManager");
const {
  RANDOM_GOLD_PICKUP_CAP,
  RANDOM_GOLD_PICKUP_VALUE,
  RANDOM_GOLD_PICKUP_RADIUS,
  RANDOM_GOLD_SPAWN_INTERVAL_MS,
  createBankBustObjects,
  createRandomGoldState,
  serializeModeObject,
  serializeRandomGoldPickup,
  expireCollectionEvents,
} = require("./state");

const DEFAULT_VAULT_MAX_HEALTH = 50000;
const DEFAULT_MATCH_DURATION_MS = 1800000;
const DEFAULT_RESPAWN_DELAY_MS = 500;
const DEFAULT_RESPAWN_SHIELD_MS = 3000;
const ALERT_RETENTION_MS = 2200;
const TURRET_PROJECTILE_RADIUS = 18;
const TURRET_PROJECTILE_MAX_LIFETIME_MS = 2200;

function buildVaultState(
  team,
  layoutVault = null,
  maxHealth = DEFAULT_VAULT_MAX_HEALTH,
) {
  return {
    team,
    label:
      String(layoutVault?.label || "").trim() ||
      (team === "team1" ? "Blue Vault" : "Red Vault"),
    maxHealth,
    health: maxHealth,
    destroyedAt: null,
    x: Number(layoutVault?.x) || 0,
    y: Number(layoutVault?.y) || 0,
    radius: Math.max(30, Number(layoutVault?.radius) || 90),
    width: Math.max(50, Number(layoutVault?.width) || 150),
    height: Math.max(50, Number(layoutVault?.height) || 180),
  };
}

function distance(aX, aY, bX, bY) {
  return Math.hypot(
    (Number(aX) || 0) - (Number(bX) || 0),
    (Number(aY) || 0) - (Number(bY) || 0),
  );
}

function pointInRect(px, py, cx, cy, width, height) {
  const halfW = Math.max(1, Number(width) || 0) / 2;
  const halfH = Math.max(1, Number(height) || 0) / 2;
  return (
    Number(px) >= Number(cx) - halfW &&
    Number(px) <= Number(cx) + halfW &&
    Number(py) >= Number(cy) - halfH &&
    Number(py) <= Number(cy) + halfH
  );
}

function segmentIntersectsExpandedRect(
  x1,
  y1,
  x2,
  y2,
  cx,
  cy,
  width,
  height,
  expansion = 0,
) {
  const halfW = Math.max(1, Number(width) || 0) / 2 + Math.max(0, Number(expansion) || 0);
  const halfH = Math.max(1, Number(height) || 0) / 2 + Math.max(0, Number(expansion) || 0);
  const left = Number(cx) - halfW;
  const right = Number(cx) + halfW;
  const top = Number(cy) - halfH;
  const bottom = Number(cy) + halfH;

  // Quick accept if either endpoint is inside.
  if (
    (Number(x1) >= left && Number(x1) <= right && Number(y1) >= top && Number(y1) <= bottom) ||
    (Number(x2) >= left && Number(x2) <= right && Number(y2) >= top && Number(y2) <= bottom)
  ) {
    return true;
  }

  const dx = Number(x2) - Number(x1);
  const dy = Number(y2) - Number(y1);
  let t0 = 0;
  let t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  return (
    clip(-dx, Number(x1) - left) &&
    clip(dx, right - Number(x1)) &&
    clip(-dy, Number(y1) - top) &&
    clip(dy, bottom - Number(y1))
  );
}

class BankBustGameMode extends BaseGameMode {
  getSettings() {
    return {
      vaultMaxHp:
        Number(this.descriptor?.settings?.vaultMaxHp) ||
        DEFAULT_VAULT_MAX_HEALTH,
      matchDurationMs:
        Number(this.descriptor?.settings?.matchDurationMs) ||
        DEFAULT_MATCH_DURATION_MS,
      respawnDelayMs:
        Number(this.descriptor?.settings?.respawnDelayMs) ||
        DEFAULT_RESPAWN_DELAY_MS,
      respawnShieldMs:
        Number(this.descriptor?.settings?.respawnShieldMs) ||
        DEFAULT_RESPAWN_SHIELD_MS,
    };
  }

  getLayout() {
    return getMapObjectiveLayout(this.room?.matchData?.map, "bankBust") || null;
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
      respawnShieldMs: settings.respawnShieldMs,
      teamGold: { team1: 0, team2: 0 },
      objects: createBankBustObjects(layout),
      randomGold: createRandomGoldState(layout),
      collectionEvents: [],
      turretProjectiles: [],
      lastProjectileTickAt: Date.now(),
      vaults: {
        team1: buildVaultState(
          "team1",
          layout?.vaults?.team1,
          settings.vaultMaxHp,
        ),
        team2: buildVaultState(
          "team2",
          layout?.vaults?.team2,
          settings.vaultMaxHp,
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
    state.phase = "active";
    state.startedAt = now;
    state.endsAt = now + this.getMatchDurationMs();
    state.randomGold.nextSpawnAt = now + RANDOM_GOLD_SPAWN_INTERVAL_MS;
  }

  getRespawnPlan(playerData) {
    const state = this.getModeState();
    const layout = this.getLayout();
    const respawn = layout?.respawnPoints?.[playerData?.team] || null;
    return {
      enabled: true,
      delayMs: Number(state?.respawnDelayMs) || DEFAULT_RESPAWN_DELAY_MS,
      shieldMs: Number(state?.respawnShieldMs) || DEFAULT_RESPAWN_SHIELD_MS,
      spawn: "team-base",
      team: playerData?.team || null,
      position: respawn
        ? { x: Number(respawn.x) || 0, y: Number(respawn.y) || 0 }
        : null,
    };
  }

  getVaultState(targetTeam) {
    const state = this.getModeState();
    return state?.vaults?.[targetTeam] || null;
  }

  addTeamGold(team, amount, meta = {}) {
    const state = this.getModeState();
    if (!state?.teamGold?.[team]) state.teamGold[team] = 0;
    const gold = Math.max(0, Number(amount) || 0);
    if (gold <= 0 || (team !== "team1" && team !== "team2")) return 0;
    state.teamGold[team] =
      Math.max(0, Number(state.teamGold[team]) || 0) + gold;
    state.collectionEvents = Array.isArray(state.collectionEvents)
      ? state.collectionEvents
      : [];
    state.collectionEvents.push({
      type: meta?.type || "gold",
      team,
      amount: gold,
      source: meta?.source || null,
      collectedBy: meta?.collectedBy || null,
      at: Date.now(),
    });
    return gold;
  }

  spendTeamGold(team, amount) {
    const state = this.getModeState();
    const gold = Math.max(0, Number(amount) || 0);
    if (gold <= 0 || (team !== "team1" && team !== "team2")) return false;
    const current = Math.max(0, Number(state?.teamGold?.[team]) || 0);
    if (current < gold) return false;
    state.teamGold[team] = current - gold;
    return true;
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
          ? Number(entry?.state?.claimRadius) || 110
          : Number(entry?.state?.buildRadius) || 100;
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
      const cost = Math.max(0, Number(target?.state?.claimCost) || 0);
      if (!this.spendTeamGold(playerData.team, cost)) {
        return { handled: true, shouldBroadcastSnapshot: false };
      }
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
      if (!this.spendTeamGold(playerData.team, cost)) {
        return { handled: true, shouldBroadcastSnapshot: false };
      }
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

    state.recentAlerts = Array.isArray(state.recentAlerts)
      ? state.recentAlerts.filter(
          (alert) => now - (Number(alert?.at) || 0) <= ALERT_RETENTION_MS,
        )
      : [];
    state.collectionEvents = expireCollectionEvents(
      state.collectionEvents,
      now,
    );

    this._tickGoldMines(now);
    this._tickRandomGold(now);
    this._collectMineGold(now);
    this._collectRandomGold(now);
    this._tickTurretProjectiles(now);
    this._tickClaimedTurrets(now);
  }

  _tickClaimedTurrets(now) {
    const state = this.getModeState();
    const players = this._eligiblePlayers();
    for (const entry of Array.isArray(state?.objects) ? state.objects : []) {
      if (entry?.type !== "claimableTurret") continue;
      const ownerTeam = entry?.state?.claimedByTeam || null;
      if (ownerTeam !== "team1" && ownerTeam !== "team2") continue;
      const range = Math.max(80, Number(entry?.state?.range) || 520);
      const target = players
        .filter((player) => player.team !== ownerTeam)
        .sort(
          (a, b) =>
            distance(a.x, a.y, entry.x, entry.y) -
            distance(b.x, b.y, entry.x, entry.y),
        )
        .find(
          (player) => distance(player.x, player.y, entry.x, entry.y) <= range,
        );

      if (!target) continue;
      const aimAngle = Math.atan2(
        (Number(target.y) || 0) - (Number(entry.y) || 0),
        (Number(target.x) || 0) - (Number(entry.x) || 0),
      );
      entry.state.aimAngle = aimAngle;
      const fireRateMs = Math.max(200, Number(entry?.state?.fireRateMs) || 900);
      if (now - (Number(entry?.state?.lastShotAt) || 0) < fireRateMs) continue;
      entry.state.lastShotAt = now;
      entry.state.lastTargetName = target.name;
      entry.state.lastTargetX = Number(target.x) || 0;
      entry.state.lastTargetY = Number(target.y) || 0;
      const projectileSpeed = Math.max(
        120,
        Number(entry?.state?.projectileSpeed) || 520,
      );
      const rawDamage = Math.max(1, Number(entry?.state?.damage) || 700);
      state.turretProjectiles = Array.isArray(state.turretProjectiles)
        ? state.turretProjectiles
        : [];
      state.turretProjectiles.push({
        id: `turret-shot-${entry.id}-${now}`,
        ownerTeam,
        sourceId: entry.id,
        x: Number(entry.x) || 0,
        y: Number(entry.y) || 0,
        vx: Math.cos(aimAngle) * projectileSpeed,
        vy: Math.sin(aimAngle) * projectileSpeed,
        radius: TURRET_PROJECTILE_RADIUS,
        damage: rawDamage,
        spawnedAt: now,
        lastUpdatedAt: now,
        maxLifetimeMs: TURRET_PROJECTILE_MAX_LIFETIME_MS,
      });
    }
  }

  _tickTurretProjectiles(now) {
    const state = this.getModeState();
    if (
      !Array.isArray(state?.turretProjectiles) ||
      !state.turretProjectiles.length
    ) {
      state.lastProjectileTickAt = now;
      return;
    }
    const players = this._eligiblePlayers();
    const builtWalls = (
      Array.isArray(state?.objects) ? state.objects : []
    ).filter(
      (entry) =>
        entry?.type === "wallSlot" &&
        (entry?.state?.builtByTeam === "team1" ||
          entry?.state?.builtByTeam === "team2"),
    );
    const remaining = [];
    for (const shot of state.turretProjectiles) {
      const prevX = Number(shot?.x) || 0;
      const prevY = Number(shot?.y) || 0;
      const lastUpdatedAt = Number(shot?.lastUpdatedAt) || now;
      const dtMs = Math.max(0, now - lastUpdatedAt);
      const dt = dtMs / 1000;
      shot.x = (Number(shot?.x) || 0) + (Number(shot?.vx) || 0) * dt;
      shot.y = (Number(shot?.y) || 0) + (Number(shot?.vy) || 0) * dt;
      shot.lastUpdatedAt = now;

      const expired =
        now - (Number(shot?.spawnedAt) || now) >
        Math.max(
          200,
          Number(shot?.maxLifetimeMs) || TURRET_PROJECTILE_MAX_LIFETIME_MS,
        );
      if (expired) continue;

      const hitWall = builtWalls.some((wall) => {
        const width = Number(wall?.state?.width) || Number(wall?.width) || 120;
        const height = Number(wall?.state?.height) || Number(wall?.height) || 46;
        return segmentIntersectsExpandedRect(
          prevX,
          prevY,
          shot.x,
          shot.y,
          wall.x,
          wall.y,
          width,
          height,
          Number(shot?.radius) || TURRET_PROJECTILE_RADIUS,
        );
      });
      if (hitWall) continue;

      const hitRadius = Math.max(
        8,
        Number(shot?.radius) || TURRET_PROJECTILE_RADIUS,
      );
      const target = players.find((player) => {
        if (player.team === shot.ownerTeam) return false;
        return distance(player.x, player.y, shot.x, shot.y) <= hitRadius + 26;
      });
      if (!target) {
        remaining.push(shot);
        continue;
      }

      const previousHealth = Math.max(0, Number(target.health) || 0);
      const appliedRawDamage = Math.round(
        Math.max(1, Number(shot?.damage) || 0) *
          (effectManager.getModifiers(target, now).damageTakenMult || 1),
      );
      target.health = Math.max(0, previousHealth - appliedRawDamage);
      const appliedDamage = previousHealth - target.health;
      if (appliedDamage <= 0) continue;

      target.lastDamagedAt = now;
      target.lastCombatAt = now;
      this.room._broadcastHealthUpdate(target, { cause: "turret-projectile" });
      if (target.health <= 0 && previousHealth > 0) {
        this.room._handlePlayerDeath(target, {
          cause: "turret-projectile",
          killedBy: `${shot.ownerTeam}-turret`,
          at: now,
        });
      }
    }
    state.turretProjectiles = remaining;
    state.lastProjectileTickAt = now;
  }

  _tickGoldMines(now) {
    const state = this.getModeState();
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
      mine.lastGeneratedAt = now;
    }
  }

  _tickRandomGold(now) {
    const state = this.getModeState();
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

    randomGold.pickups.push({
      id: `rand-gold-${now}-${randomGold.nextSpawnIdx}`,
      x: Number(spawnPoint.x) || 0,
      y: Number(spawnPoint.y) || 0,
      value: RANDOM_GOLD_PICKUP_VALUE,
      radius: RANDOM_GOLD_PICKUP_RADIUS,
      spawnedAt: now,
    });
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

  _collectMineGold(now) {
    const state = this.getModeState();
    const players = this._eligiblePlayers();
    for (const entry of Array.isArray(state?.objects) ? state.objects : []) {
      if (entry?.type !== "goldMine") continue;
      const mine = entry.state || {};
      const storedGold = Math.max(0, Number(mine.storedGold) || 0);
      if (storedGold <= 0) continue;
      for (const player of players) {
        const dist = distance(player.x, player.y, entry.x, entry.y);
        if (dist > (Number(mine.collectionRadius) || 110)) continue;
        mine.storedGold = 0;
        this.addTeamGold(player.team, storedGold, {
          type: "goldMine",
          source: entry.id,
          collectedBy: player.name,
        });
        break;
      }
    }
  }

  _collectRandomGold(now) {
    const state = this.getModeState();
    const randomGold = state?.randomGold;
    if (!randomGold?.pickups?.length) return;
    const players = this._eligiblePlayers();
    const remaining = [];
    for (const pickup of randomGold.pickups) {
      let collected = false;
      for (const player of players) {
        const dist = distance(player.x, player.y, pickup.x, pickup.y);
        if (dist > (Number(pickup.radius) || RANDOM_GOLD_PICKUP_RADIUS))
          continue;
        this.addTeamGold(player.team, pickup.value, {
          type: "randomGold",
          source: pickup.id,
          collectedBy: player.name,
        });
        collected = true;
        break;
      }
      if (!collected) remaining.push(pickup);
    }
    randomGold.pickups = remaining;
  }

  onDeathDropCollected(playerData, drop) {
    if (!playerData || !drop || drop.type !== "coin") return null;
    const amount = Math.max(1, Number(drop.value) || 1);
    this.addTeamGold(playerData.team, amount, {
      type: "deathDropCoin",
      source: drop.id,
      collectedBy: playerData.name,
    });
    return { suppressDefaultReward: true };
  }

  damageVault(targetTeam, rawDamage, meta = {}) {
    const state = this.getModeState();
    const vaultState = this.getVaultState(targetTeam);
    if (!state || !vaultState) return null;

    const damage = Math.max(0, Math.round(Number(rawDamage) || 0));
    if (damage <= 0 || vaultState.health <= 0) return vaultState;

    const now = Date.now();
    vaultState.health = Math.max(0, vaultState.health - damage);
    if (vaultState.health === 0 && !vaultState.destroyedAt) {
      vaultState.destroyedAt = now;
      state.phase = "finished";
    }

    state.lastVaultDamageEvent = {
      type: "vault-under-attack",
      targetTeam,
      sourceTeam: meta?.sourceTeam || null,
      sourcePlayer: meta?.sourcePlayer || null,
      damage,
      health: vaultState.health,
      maxHealth: vaultState.maxHealth,
      at: now,
    };

    state.recentAlerts = Array.isArray(state.recentAlerts)
      ? state.recentAlerts
      : [];
    state.recentAlerts.push({
      type: "vault-under-attack",
      targetTeam,
      at: now,
      sourcePlayer: meta?.sourcePlayer || null,
    });

    return vaultState;
  }

  evaluateVictoryState() {
    const state = this.getModeState();
    const team1Vault = state?.vaults?.team1;
    const team2Vault = state?.vaults?.team2;
    if (!team1Vault || !team2Vault) return null;

    if (team1Vault.health <= 0 && team2Vault.health <= 0) {
      return {
        terminal: true,
        winnerTeam: null,
        outcomeKey: "draw",
        meta: {
          outcome: "draw",
          destroyedObjectives: ["team1", "team2"],
          finishDelayMs: 0,
        },
      };
    }
    if (team1Vault.health <= 0) {
      return {
        terminal: true,
        winnerTeam: "team2",
        outcomeKey: "team2",
        meta: {
          outcome: "team2",
          destroyedObjective: "team1",
          finishDelayMs: 0,
        },
      };
    }
    if (team2Vault.health <= 0) {
      return {
        terminal: true,
        winnerTeam: "team1",
        outcomeKey: "team1",
        meta: {
          outcome: "team1",
          destroyedObjective: "team2",
          finishDelayMs: 0,
        },
      };
    }
    return null;
  }

  onTimerExpired() {
    const immediate = this.evaluateVictoryState();
    if (immediate?.terminal) return immediate;

    const state = this.getModeState();
    const team1Vault = state?.vaults?.team1;
    const team2Vault = state?.vaults?.team2;
    if (!team1Vault || !team2Vault) {
      return {
        terminal: true,
        winnerTeam: null,
        outcomeKey: "draw",
        meta: { timerExpired: true, tiebreakReason: "missing-vault-state" },
      };
    }

    state.phase = "finished";

    if (team1Vault.health === team2Vault.health) {
      return {
        terminal: true,
        winnerTeam: null,
        outcomeKey: "draw",
        meta: {
          timerExpired: true,
          tiebreakReason: "equal-vault-health",
          team1VaultHealth: team1Vault.health,
          team2VaultHealth: team2Vault.health,
          finishDelayMs: 0,
        },
      };
    }

    const winnerTeam =
      team1Vault.health < team2Vault.health ? "team2" : "team1";
    return {
      terminal: true,
      winnerTeam,
      outcomeKey: winnerTeam,
      meta: {
        timerExpired: true,
        tiebreakReason: "vault-health",
        team1VaultHealth: team1Vault.health,
        team2VaultHealth: team2Vault.health,
        finishDelayMs: 0,
      },
    };
  }

  buildModeState() {
    const state = this.getModeState();
    const layout = this.getLayout();
    const settings = this.getSettings();
    return {
      type: "bank-bust",
      topology: "team-vs-team",
      phase: state?.phase || "setup",
      objectiveLabel: "Destroy the enemy vault",
      matchDurationMs:
        Number(state?.matchDurationMs) || settings.matchDurationMs,
      startedAt: state?.startedAt || null,
      endsAt: state?.endsAt || null,
      respawns: true,
      respawnDelayMs: Number(state?.respawnDelayMs) || settings.respawnDelayMs,
      respawnShieldMs:
        Number(state?.respawnShieldMs) || settings.respawnShieldMs,
      teamGold: {
        team1: Math.max(0, Number(state?.teamGold?.team1) || 0),
        team2: Math.max(0, Number(state?.teamGold?.team2) || 0),
      },
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
      collectionEvents: Array.isArray(state?.collectionEvents)
        ? state.collectionEvents.slice(-10)
        : [],
      vaults: {
        team1: {
          health: state?.vaults?.team1?.health ?? settings.vaultMaxHp,
          maxHealth: state?.vaults?.team1?.maxHealth ?? settings.vaultMaxHp,
          destroyedAt: state?.vaults?.team1?.destroyedAt || null,
          x: state?.vaults?.team1?.x ?? (Number(layout?.vaults?.team1?.x) || 0),
          y: state?.vaults?.team1?.y ?? (Number(layout?.vaults?.team1?.y) || 0),
          width:
            state?.vaults?.team1?.width ??
            (Number(layout?.vaults?.team1?.width) || 150),
          height:
            state?.vaults?.team1?.height ??
            (Number(layout?.vaults?.team1?.height) || 180),
          radius:
            state?.vaults?.team1?.radius ??
            (Number(layout?.vaults?.team1?.radius) || 90),
          label: state?.vaults?.team1?.label || "Blue Vault",
        },
        team2: {
          health: state?.vaults?.team2?.health ?? settings.vaultMaxHp,
          maxHealth: state?.vaults?.team2?.maxHealth ?? settings.vaultMaxHp,
          destroyedAt: state?.vaults?.team2?.destroyedAt || null,
          x: state?.vaults?.team2?.x ?? (Number(layout?.vaults?.team2?.x) || 0),
          y: state?.vaults?.team2?.y ?? (Number(layout?.vaults?.team2?.y) || 0),
          width:
            state?.vaults?.team2?.width ??
            (Number(layout?.vaults?.team2?.width) || 150),
          height:
            state?.vaults?.team2?.height ??
            (Number(layout?.vaults?.team2?.height) || 180),
          radius:
            state?.vaults?.team2?.radius ??
            (Number(layout?.vaults?.team2?.radius) || 90),
          label: state?.vaults?.team2?.label || "Red Vault",
        },
      },
      respawnPoints: {
        team1: layout?.respawnPoints?.team1 || null,
        team2: layout?.respawnPoints?.team2 || null,
      },
      lastVaultDamageEvent: state?.lastVaultDamageEvent || null,
      recentAlerts: Array.isArray(state?.recentAlerts)
        ? state.recentAlerts
        : [],
    };
  }
}

module.exports = { BankBustGameMode };
