const { exposeDamageHitbox } = require('../../gameRoom/damageHitboxes');
const { PICKUP_DELAY_MS } = require("../../../../shared/powerups");
const { BaseGameMode } = require("../BaseGameMode");
const { getModeById } = require("../../../../shared/gameSelection");
const effectManager = require("../../gameRoom/effects/effectManager");
const { reduceDuckDamage } = require("../../../../shared/physics/ducking");
const {
  RANDOM_GOLD_PICKUP_CAP,
  RANDOM_GOLD_PICKUP_VALUE,
  RANDOM_GOLD_PICKUP_RADIUS,
  RANDOM_GOLD_SPAWN_INTERVAL_MS,
  RANDOM_GOLD_ARRIVE_MS,
  RANDOM_GOLD_CLAIMABLE_MS,
  COIN_EVENT_SNAPSHOT_LIMIT,
  CENTER_GOLD_FIRST_SPAWN_MS,
  CENTER_GOLD_INTERVAL_MS,
  CENTER_GOLD_ANNOUNCE_LEAD_MS,
  CENTER_GOLD_LIFETIME_MS,
  CENTER_GOLD_SPILL_PILES,
  CENTER_GOLD_SPILL_SPACING,
  CENTER_GOLD_SPILL_LIFT,
  createBankBustObjects,
  createRandomGoldState,
  createCenterGoldState,
  serializeModeObject,
  serializeRandomGoldPickup,
  expireCoinEvents,
} = require("./state");

// Match rules live in gameModes.catalog.json under the "bank-bust" mode's
// `settings`; these defaults read from that same entry so a room built without
// a descriptor still matches the catalog.
const CATALOG_SETTINGS = getModeById("bank-bust")?.settings || {};
const DEFAULT_VAULT_STARTING_COINS = CATALOG_SETTINGS.vaultStartingCoins;
// A death-drop coin is worth 1 to the player's wallet, but the vault runs on the
// same scale as combat damage, so banking one is worth this many vault coins.
const DEFAULT_DEATH_DROP_VAULT_COINS = CATALOG_SETTINGS.deathDropVaultCoins;
// A purchase may never take a vault below this, so a team cannot buy itself
// into a loss.
const DEFAULT_PURCHASE_FLOOR_COINS = CATALOG_SETTINGS.purchaseFloorCoins;
const DEFAULT_LOW_COINS_RATIO = CATALOG_SETTINGS.lowCoinsRatio;
const DEFAULT_MATCH_DURATION_MS = CATALOG_SETTINGS.matchDurationMs;
const DEFAULT_RESPAWN_DELAY_MS = CATALOG_SETTINGS.respawnDelayMs;
const DEFAULT_RESPAWN_SHIELD_MS = CATALOG_SETTINGS.respawnShieldMs;
// How long the match runs on after a vault is emptied. The bust is drawn from
// the snapshot that shows the vault at zero, and finishing on the killing blow
// stopped the loop before that snapshot was ever sent.
const VAULT_BUST_FINISH_DELAY_MS = 1800;
// Vault-under-attack alerts stay in the snapshot this long.
const ALERT_RETENTION_MS = 2200;
// Vault turret bullets: hit radius (px) and max flight time.
const TURRET_PROJECTILE_RADIUS = 10;
const TURRET_PROJECTILE_MAX_LIFETIME_MS = 2200;

function buildVaultState(
  team,
  layoutVault = null,
  startingCoins = DEFAULT_VAULT_STARTING_COINS,
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
  const halfW =
    Math.max(1, Number(width) || 0) / 2 + Math.max(0, Number(expansion) || 0);
  const halfH =
    Math.max(1, Number(height) || 0) / 2 + Math.max(0, Number(expansion) || 0);
  const left = Number(cx) - halfW;
  const right = Number(cx) + halfW;
  const top = Number(cy) - halfH;
  const bottom = Number(cy) + halfH;

  // Quick accept if either endpoint is inside.
  if (
    (Number(x1) >= left &&
      Number(x1) <= right &&
      Number(y1) >= top &&
      Number(y1) <= bottom) ||
    (Number(x2) >= left &&
      Number(x2) <= right &&
      Number(y2) >= top &&
      Number(y2) <= bottom)
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
      vaultStartingCoins:
        Number(this.descriptor?.settings?.vaultStartingCoins) ||
        DEFAULT_VAULT_STARTING_COINS,
      deathDropVaultCoins:
        Number(this.descriptor?.settings?.deathDropVaultCoins) ||
        DEFAULT_DEATH_DROP_VAULT_COINS,
      purchaseFloorCoins: Math.max(
        0,
        Number(this.descriptor?.settings?.purchaseFloorCoins) ??
          DEFAULT_PURCHASE_FLOOR_COINS,
      ),
      lowCoinsRatio:
        Number(this.descriptor?.settings?.lowCoinsRatio) ||
        DEFAULT_LOW_COINS_RATIO,
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
      respawnShieldMs: settings.respawnShieldMs,
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
      delayMs: Number(state?.respawnDelayMs) || DEFAULT_RESPAWN_DELAY_MS,
      shieldMs: Number(state?.respawnShieldMs) || DEFAULT_RESPAWN_SHIELD_MS,
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
    return this.getShotBlockers(null);
  }

  // Built walls stop the other team's shots. The builder's own team shoots
  // through them, though it cannot walk through them.
  getShotBlockers(shooterTeam) {
    const blockers = [];
    for (const entry of this.getModeState()?.objects || []) {
      const owner = entry?.type === "wallSlot" ? entry.state?.builtByTeam : null;
      if (!owner || owner === shooterTeam) continue;
      const halfW = (Number(entry.state.width) || 48) / 2;
      const halfH = (Number(entry.state.height) || 96) / 2;
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
    const state = this.getModeState();
    return state?.vaults?.[targetTeam] || null;
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
    return Math.max(0, Number(this.getVaultState(team)?.coins) || 0);
  }

  // Every coin movement in the mode goes through here: pickups, mine hauls,
  // death drops, centre gold, enemy damage and purchases. It owns the number,
  // clamps it and writes the ledger entry the client renders from.
  applyVaultCoins(team, delta, meta = {}) {
    const state = this.getModeState();
    const vault = this.getVaultState(team);
    const change = Math.round(Number(delta) || 0);
    if (!state || !vault || !change) return null;
    if (team !== "team1" && team !== "team2") return null;
    // Once a vault is gone the result is settled, including while the bust
    // plays out: nothing can bank coins or empty the winner's vault as well.
    if (vault.destroyedAt || state.phase === "finished") return null;

    const before = Math.max(0, Number(vault.coins) || 0);
    const after = Math.max(0, before + change);
    const applied = after - before;
    if (!applied) return null;

    const now = Number(meta?.at) || Date.now();
    vault.coins = after;
    if (after === 0 && !vault.destroyedAt) {
      vault.destroyedAt = now;
      state.phase = "finished";
    }

    state.coinEvents = Array.isArray(state.coinEvents) ? state.coinEvents : [];
    state.coinEvents.push({
      // Why the number moved, so the client can pick the right feedback.
      reason: String(meta?.reason || (applied > 0 ? "gain" : "loss")),
      team,
      delta: applied,
      coins: after,
      source: meta?.source || null,
      actor: meta?.actor || null,
      actorTeam: meta?.actorTeam || null,
      x: Number.isFinite(Number(meta?.x)) ? Number(meta.x) : null,
      y: Number.isFinite(Number(meta?.y)) ? Number(meta.y) : null,
      at: now,
    });
    return { before, after, applied, vault };
  }

  // Purchases are paid out of the vault, but never far enough to hand the
  // other team a win: the floor is the last thing a team can spend down to.
  canAffordPurchase(team, cost) {
    const state = this.getModeState(), vault = this.getVaultState(team);
    const amount = Number(cost);
    if (!vault || vault.destroyedAt || state?.phase === "finished" || !Number.isFinite(amount) || amount < 0) return false;
    const price = Math.round(amount);
    const configuredFloor = Number(state?.purchaseFloorCoins);
    const floor = Number.isFinite(configuredFloor) ? Math.max(0, configuredFloor) : DEFAULT_PURCHASE_FLOOR_COINS;
    const remaining = this.getVaultCoins(team) - price;
    // Even a map configured with a zero purchase floor cannot buy a loss.
    return remaining > 0 && remaining >= floor;
  }

  spendVaultCoins(team, cost, meta = {}) {
    const price = Math.max(0, Math.round(Number(cost) || 0));
    if (team !== "team1" && team !== "team2") return false;
    if (!this.canAffordPurchase(team, price)) return false;
    if (price === 0) return true;
    return !!this.applyVaultCoins(team, -price, {
      ...meta,
      reason: meta?.reason || "purchase",
    });
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
    state.coinEvents = expireCoinEvents(state.coinEvents, now);

    this._tickGoldMines(now);
    this._tickRandomGold(now);
    this._tickCenterGold(now);
    this._collectMineGold(now);
    this._collectRandomGold(now);
    this._tickTurretProjectiles(now);
    this._tickClaimedTurrets(now);
  }

  // The contested centre crate. It runs on a fixed announce -> spawn -> expire
  // cycle at one visible spot, so both teams can commit to the fight in advance
  // and no single drop decides the match.
  _tickCenterGold(now) {
    const state = this.getModeState();
    const site = state?.centerGold;
    if (!site?.enabled) return;

    if (site.phase === "scheduled" && now >= Number(site.announceAt || 0)) {
      site.phase = "announced";
    }

    if (
      (site.phase === "scheduled" || site.phase === "announced") &&
      now >= Number(site.spawnAt || 0)
    ) {
      site.phase = "active";
      site.round = (Number(site.round) || 0) + 1;
      site.expiresAt = now + CENTER_GOLD_LIFETIME_MS;
      site.health = site.maxHealth;
      site.lastHit = null;
    }

    if (site.phase === "active" && now >= Number(site.expiresAt || 0)) {
      this._resolveCenterGold(now, "expired");
    }
  }

  // The crate while it can be hit, or null. Attack runtimes test this exactly
  // as they test a vault; either team may damage it.
  getCenterCrate() {
    const site = this.getModeState()?.centerGold;
    if (!site?.enabled || site.phase !== "active" || !(site.health > 0)) return null;
    return site;
  }

  damageCenterCrate(rawDamage, meta = {}) {
    const site = this.getCenterCrate();
    const damage = Math.max(0, Math.round(Number(rawDamage) || 0));
    if (!site || damage <= 0) return 0;
    const now = Number(meta?.at) || Date.now();
    const applied = Math.min(site.health, damage);
    site.health -= applied;
    // Where the blow came from, so the crate can rock away from it.
    site.lastHit = {
      at: now,
      x: Number.isFinite(Number(meta?.x)) ? Number(meta.x) : site.x,
      damage: applied,
      team: meta?.sourceTeam || null,
    };
    if (site.health <= 0) {
      site.lastBreak = {
        team: meta?.sourceTeam || null,
        player: meta?.sourcePlayer || null,
        round: site.round,
        at: now,
      };
      this._spillCenterCrate(site, now);
      this._resolveCenterGold(now, "broken");
    }
    return applied;
  }

  _spillCenterCrate(site, now) {
    const randomGold = this.getModeState()?.randomGold;
    if (!randomGold) return;
    if (!Array.isArray(randomGold.pickups)) randomGold.pickups = [];
    const piles = CENTER_GOLD_SPILL_PILES;
    const floorY = site.y + site.height / 2;
    const value = Math.floor(site.reward / piles);
    for (let i = 0; i < piles; i++) {
      randomGold.pickups.push({
        id: `center-gold-${site.round}-${i}`,
        x: site.x + (i - (piles - 1) / 2) * CENTER_GOLD_SPILL_SPACING,
        y: floorY - CENTER_GOLD_SPILL_LIFT,
        // Division leftovers go in the first pile, so the crate pays in full.
        value: i === 0 ? site.reward - value * (piles - 1) : value,
        radius: RANDOM_GOLD_PICKUP_RADIUS,
        spawnedAt: now,
        arrivalMs: RANDOM_GOLD_ARRIVE_MS,
        claimableMs: RANDOM_GOLD_CLAIMABLE_MS,
        reason: "centerGold",
        fromX: site.x,
        fromY: site.y,
      });
    }
  }

  _resolveCenterGold(now, outcome) {
    const state = this.getModeState();
    const site = state?.centerGold;
    if (!site) return;
    site.phase = "cooldown";
    site.lastResolvedAt = now;
    site.lastOutcome = outcome;
    site.expiresAt = null;
    site.health = 0;
    const nextSpawnAt = now + CENTER_GOLD_INTERVAL_MS;
    const matchEndsAt = Number(state?.endsAt) || 0;
    // Do not schedule a drop that cannot be reached before the clock runs out.
    if (matchEndsAt && nextSpawnAt + 4000 >= matchEndsAt) {
      site.phase = "done";
      site.spawnAt = null;
      site.announceAt = null;
      return;
    }
    site.spawnAt = nextSpawnAt;
    site.announceAt = nextSpawnAt - CENTER_GOLD_ANNOUNCE_LEAD_MS;
    site.phase = "scheduled";
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
        const width = Number(wall?.state?.width) || Number(wall?.width) || 48;
        const height =
          Number(wall?.state?.height) || Number(wall?.height) || 96;
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
      exposeDamageHitbox(this.room, shot, { kind: 'circle', x: shot.x, y: shot.y, radius: hitRadius + 26 }, now);
      const target = players.find((player) => {
        if (player.team === shot.ownerTeam) return false;
        return distance(player.x, player.y, shot.x, shot.y) <= hitRadius + 26;
      });
      if (!target) {
        remaining.push(shot);
        continue;
      }

      const previousHealth = Math.max(0, Number(target.health) || 0);
      let appliedRawDamage = Math.round(
        Math.max(1, Number(shot?.damage) || 0) *
          (effectManager.getModifiers(target, now).damageTakenMult || 1),
      );
      const duckBlocked = target.ducking === true;
      appliedRawDamage = Math.round(reduceDuckDamage(target, appliedRawDamage));
      target.health = Math.max(0, previousHealth - appliedRawDamage);
      const appliedDamage = previousHealth - target.health;
      if (appliedDamage <= 0) continue;

      target.lastDamagedAt = now;
      target.lastCombatAt = now;
      this.room._broadcastHealthUpdate(target, {
        cause: "turret-projectile",
        duckBlocked,
      });
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
      arrivalMs: RANDOM_GOLD_ARRIVE_MS,
      claimableMs: RANDOM_GOLD_CLAIMABLE_MS,
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
        this.applyVaultCoins(player.team, storedGold, {
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

  _collectRandomGold(now) {
    const state = this.getModeState();
    const randomGold = state?.randomGold;
    if (!randomGold?.pickups?.length) return;
    const players = this._eligiblePlayers();
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
        this.applyVaultCoins(player.team, pickup.value, {
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
    randomGold.pickups = remaining;
  }

  onDeathDropCollected(playerData, drop) {
    if (!playerData || !drop || drop.type !== "coin") return null;
    const amount = Math.max(1, Number(drop.value) || 1) * this.getSettings().deathDropVaultCoins;
    this.applyVaultCoins(playerData.team, amount, {
      reason: "deathDrop",
      source: drop.id,
      actor: playerData.name,
      actorTeam: playerData.team,
      x: Number(drop.x) || Number(playerData.x) || 0,
      y: Number(drop.y) || Number(playerData.y) || 0,
    });
    return { suppressDefaultReward: true };
  }

  damageVault(targetTeam, rawDamage, meta = {}) {
    const state = this.getModeState();
    const vaultState = this.getVaultState(targetTeam);
    if (!state || !vaultState) return null;

    const damage = Math.max(0, Math.round(Number(rawDamage) || 0));
    if (damage <= 0 || vaultState.coins <= 0) return vaultState;

    // One point of damage is one coin: the vault is on the same scale as a
    // player's health bar, so a 1200 hit takes 1200 either way.
    const now = Date.now();
    const result = this.applyVaultCoins(targetTeam, -damage, {
      reason: "enemyAttack",
      source: meta?.attackType || null,
      actor: meta?.sourcePlayer || null,
      actorTeam: meta?.sourceTeam || null,
      x: vaultState.x,
      y: vaultState.y,
      at: now,
    });
    if (!result) return vaultState;

    state.lastVaultDamageEvent = {
      type: "vault-under-attack",
      targetTeam,
      sourceTeam: meta?.sourceTeam || null,
      sourcePlayer: meta?.sourcePlayer || null,
      coinsLost: -result.applied,
      coins: vaultState.coins,
      startingCoins: vaultState.startingCoins,
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

    const team1Empty = Math.max(0, Number(team1Vault.coins) || 0) <= 0;
    const team2Empty = Math.max(0, Number(team2Vault.coins) || 0) <= 0;

    if (team1Empty && team2Empty) {
      return {
        terminal: true,
        winnerTeam: null,
        outcomeKey: "draw",
        meta: {
          outcome: "draw",
          destroyedObjectives: ["team1", "team2"],
          finishDelayMs: VAULT_BUST_FINISH_DELAY_MS,
        },
      };
    }
    if (team1Empty) {
      return {
        terminal: true,
        winnerTeam: "team2",
        outcomeKey: "team2",
        meta: {
          outcome: "team2",
          destroyedObjective: "team1",
          finishDelayMs: VAULT_BUST_FINISH_DELAY_MS,
        },
      };
    }
    if (team2Empty) {
      return {
        terminal: true,
        winnerTeam: "team1",
        outcomeKey: "team1",
        meta: {
          outcome: "team1",
          destroyedObjective: "team2",
          finishDelayMs: VAULT_BUST_FINISH_DELAY_MS,
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

    // On the clock, the team with more coins still in its vault wins.
    const team1Coins = Math.max(0, Number(team1Vault.coins) || 0);
    const team2Coins = Math.max(0, Number(team2Vault.coins) || 0);

    if (team1Coins === team2Coins) {
      return {
        terminal: true,
        winnerTeam: null,
        outcomeKey: "draw",
        meta: {
          timerExpired: true,
          tiebreakReason: "equal-vault-coins",
          team1VaultCoins: team1Coins,
          team2VaultCoins: team2Coins,
          finishDelayMs: 0,
        },
      };
    }

    const winnerTeam = team1Coins > team2Coins ? "team1" : "team2";
    return {
      terminal: true,
      winnerTeam,
      outcomeKey: winnerTeam,
      meta: {
        timerExpired: true,
        tiebreakReason: "vault-coins",
        team1VaultCoins: team1Coins,
        team2VaultCoins: team2Coins,
        finishDelayMs: 0,
      },
    };
  }

  _serializeVault(team, layout, settings) {
    const vault = this.getModeState()?.vaults?.[team] || null;
    const layoutVault = layout?.vaults?.[team] || {};
    const startingCoins = Math.max(
      1,
      Number(vault?.startingCoins) || settings.vaultStartingCoins,
    );
    return {
      team,
      coins: Math.max(0, Number(vault?.coins) ?? startingCoins),
      startingCoins,
      destroyedAt: vault?.destroyedAt || null,
      x: vault?.x ?? (Number(layoutVault?.x) || 0),
      y: vault?.y ?? (Number(layoutVault?.y) || 0),
      width: vault?.width ?? (Number(layoutVault?.width) || 150),
      height: vault?.height ?? (Number(layoutVault?.height) || 180),
      radius: vault?.radius ?? (Number(layoutVault?.radius) || 90),
      label:
        vault?.label ||
        layoutVault?.label ||
        (team === "team1" ? "Blue Vault" : "Red Vault"),
    };
  }

  _serializeCenterGold() {
    const site = this.getModeState()?.centerGold || null;
    if (!site?.enabled) return null;
    return {
      enabled: true,
      phase: site.phase || "idle",
      round: Number(site.round) || 0,
      x: Number(site.x) || 0,
      y: Number(site.y) || 0,
      radius: Math.max(24, Number(site.radius) || 56),
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

  buildModeState() {
    const state = this.getModeState();
    const layout = this.getLayout();
    const settings = this.getSettings();
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
      respawnDelayMs: Number(state?.respawnDelayMs) || settings.respawnDelayMs,
      respawnShieldMs:
        Number(state?.respawnShieldMs) || settings.respawnShieldMs,
      // The only spendable number in the mode is each vault's own coins.
      purchaseFloorCoins: Math.max(
        0,
        Number(state?.purchaseFloorCoins) ?? settings.purchaseFloorCoins,
      ),
      lowCoinsRatio: Number(state?.lowCoinsRatio) || settings.lowCoinsRatio,
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
      centerGold: this._serializeCenterGold(),
      vaults: {
        team1: this._serializeVault("team1", layout, settings),
        team2: this._serializeVault("team2", layout, settings),
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
