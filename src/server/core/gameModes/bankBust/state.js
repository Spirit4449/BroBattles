// Bank Bust is built on one server-owned number per team: the coins sitting in
// that team's vault. Collecting coins adds to it, enemy attacks strip coins out
// of it, and purchases are paid out of it. There is no wallet, no reserve and
// no separate health pool anywhere in this mode.

// Loose gold scattered around the map (spawn points come from the map's
// objectiveLayout.bankBust.randomGoldSpawnPoints).
const RANDOM_GOLD_PICKUP_CAP = 5; // max loose gold pickups on the map at once
const RANDOM_GOLD_PICKUP_VALUE = 1250; // coins added to the collector's vault
const RANDOM_GOLD_PICKUP_RADIUS = 42; // pickup distance (px)
const RANDOM_GOLD_SPAWN_INTERVAL_MS = 3600; // one new pickup this often
const RANDOM_GOLD_ARRIVE_MS = 1300; // drop-and-bounce animation length
const RANDOM_GOLD_CLAIMABLE_MS = 500; // first floor touch; collectable from here

// Coin ledger entries stay in snapshots this long so the client can play the
// matching gain/loss feedback exactly once.
const COIN_EVENT_RETENTION_MS = 1800;
const COIN_EVENT_SNAPSHOT_LIMIT = 12;

// Contested centre gold: a locked crate that both teams are told about before
// it lands, so the fight over it is scheduled rather than random. Attacks break
// it open and its coins spill out as piles anyone can grab, so doing the damage
// earns the first run at them rather than the coins themselves.
const CENTER_GOLD_REWARD = 7500; // coins in the crate, split across its piles
const CENTER_GOLD_HEALTH = 15000; // damage it takes to break open
const CENTER_GOLD_SPILL_PILES = 5;
const CENTER_GOLD_SPILL_SPACING = 48; // px between piles on the hilltop
const CENTER_GOLD_SPILL_LIFT = 40; // a pile's centre above the crate's floor
const CENTER_GOLD_FIRST_SPAWN_MS = 45000; // first drop, after the opening fight
const CENTER_GOLD_INTERVAL_MS = 50000; // spawn-to-spawn cooldown
const CENTER_GOLD_ANNOUNCE_LEAD_MS = 8000; // advance warning before it lands
const CENTER_GOLD_LIFETIME_MS = 30000; // despawns if nobody breaks it
const CENTER_GOLD_RADIUS = 56;
const CENTER_GOLD_WIDTH = 124;
const CENTER_GOLD_HEIGHT = 116;

function cloneLayoutObject(def = {}) {
  return JSON.parse(JSON.stringify(def || {}));
}

function createModeObjectState(def = {}) {
  const base = {
    id: String(def?.id || `obj-${Date.now()}`),
    type: String(def?.type || "unknown"),
    x: Number(def?.x) || 0,
    y: Number(def?.y) || 0,
    teamOwner: def?.teamOwner || null,
    config: cloneLayoutObject(def),
    state: {},
  };

  if (base.type === "goldMine") {
    base.state = {
      storedGold: 0,
      lastGeneratedAt: Date.now(),
      collectionRadius: Math.max(40, Number(def?.collectionRadius) || 100),
      yieldAmount: Math.max(1, Number(def?.yieldAmount) || 500),
      yieldIntervalMs: Math.max(500, Number(def?.yieldIntervalMs) || 5000),
      maxStoredGold: Math.max(1, Number(def?.maxStoredGold) || 2000),
      radius: Math.max(20, Number(def?.radius) || 80),
    };
  } else if (base.type === "claimableTurret") {
    base.state = {
      claimedByTeam: null,
      claimRadius: Math.max(40, Number(def?.claimRadius) || 110),
      claimCost: Math.max(0, Number(def?.claimCost) || 8750),
      range: Math.max(100, Number(def?.range) || 520),
      fireRateMs: Math.max(200, Number(def?.fireRateMs) || 900),
      damage: Math.max(1, Number(def?.damage) || 700),
      projectileSpeed: Math.max(1, Number(def?.projectileSpeed) || 520),
      turnSpeed: Math.max(0.01, Number(def?.turnSpeed) || 0.08),
    };
  } else if (base.type === "wallSlot") {
    base.state = {
      builtByTeam: null,
      buildRadius: Math.max(30, Number(def?.buildRadius) || 100),
      cost: Math.max(0, Number(def?.cost) || 5500),
      width: Math.max(10, Number(def?.width) || 48),
      height: Math.max(10, Number(def?.height) || 96),
    };
  }

  return base;
}

function createBankBustObjects(layout = null) {
  const defs = Array.isArray(layout?.objects) ? layout.objects : [];
  return defs.map((entry) => createModeObjectState(entry));
}

function createRandomGoldState(layout = null) {
  return {
    spawnPoints: Array.isArray(layout?.randomGoldSpawnPoints)
      ? layout.randomGoldSpawnPoints.map((entry) => ({
          id: String(entry?.id || `gold-${Math.random().toString(16).slice(2, 8)}`),
          x: Number(entry?.x) || 0,
          y: Number(entry?.y) || 0,
        }))
      : [],
    pickups: [],
    nextSpawnAt: Date.now() + RANDOM_GOLD_SPAWN_INTERVAL_MS,
    nextSpawnIdx: 0,
  };
}

// The centre gold site is a fixed, visible location on the map. Its schedule is
// absolute (announce -> spawn -> expire) so both teams read the same clock.
function createCenterGoldState(layout = null) {
  const site = layout?.centerGold || null;
  return {
    enabled: !!site,
    x: Number(site?.x) || 0,
    y: Number(site?.y) || 0,
    radius: Math.max(24, Number(site?.radius) || CENTER_GOLD_RADIUS),
    width: Math.max(24, Number(site?.width) || CENTER_GOLD_WIDTH),
    height: Math.max(24, Number(site?.height) || CENTER_GOLD_HEIGHT),
    reward: Math.max(1, Number(site?.reward) || CENTER_GOLD_REWARD),
    maxHealth: Math.max(1, Number(site?.health) || CENTER_GOLD_HEALTH),
    health: 0,
    lastHit: null,
    phase: "idle",
    round: 0,
    announceAt: null,
    spawnAt: null,
    expiresAt: null,
    lastResolvedAt: null,
    lastBreak: null,
  };
}

function serializeModeObject(entry = {}) {
  return {
    id: entry?.id || null,
    type: entry?.type || "unknown",
    x: Number(entry?.x) || 0,
    y: Number(entry?.y) || 0,
    teamOwner: entry?.teamOwner || null,
    config: cloneLayoutObject(entry?.config || {}),
    state: cloneLayoutObject(entry?.state || {}),
  };
}

function serializeRandomGoldPickup(entry = {}) {
  return {
    id: entry?.id || null,
    type: "goldPickup",
    x: Number(entry?.x) || 0,
    y: Number(entry?.y) || 0,
    value: Math.max(1, Number(entry?.value) || RANDOM_GOLD_PICKUP_VALUE),
    radius: Math.max(10, Number(entry?.radius) || RANDOM_GOLD_PICKUP_RADIUS),
    spawnedAt: Number(entry?.spawnedAt) || Date.now(),
    // Spilled piles say where they were thrown from.
    arrivalMs: Number(entry?.arrivalMs) || 0,
    claimableMs: Number(entry?.claimableMs) || 0,
    reason: entry?.reason || null,
    fromX: Number.isFinite(entry?.fromX) ? entry.fromX : null,
    fromY: Number.isFinite(entry?.fromY) ? entry.fromY : null,
  };
}

function expireCoinEvents(events = [], now = Date.now()) {
  return Array.isArray(events)
    ? events.filter(
        (entry) => now - (Number(entry?.at) || 0) <= COIN_EVENT_RETENTION_MS,
      )
    : [];
}

module.exports = {
  RANDOM_GOLD_PICKUP_CAP,
  RANDOM_GOLD_PICKUP_VALUE,
  RANDOM_GOLD_PICKUP_RADIUS,
  RANDOM_GOLD_SPAWN_INTERVAL_MS,
  RANDOM_GOLD_ARRIVE_MS,
  RANDOM_GOLD_CLAIMABLE_MS,
  COIN_EVENT_RETENTION_MS,
  COIN_EVENT_SNAPSHOT_LIMIT,
  CENTER_GOLD_REWARD,
  CENTER_GOLD_SPILL_PILES,
  CENTER_GOLD_SPILL_SPACING,
  CENTER_GOLD_SPILL_LIFT,
  CENTER_GOLD_FIRST_SPAWN_MS,
  CENTER_GOLD_INTERVAL_MS,
  CENTER_GOLD_ANNOUNCE_LEAD_MS,
  CENTER_GOLD_LIFETIME_MS,
  CENTER_GOLD_RADIUS,
  createBankBustObjects,
  createRandomGoldState,
  createCenterGoldState,
  serializeModeObject,
  serializeRandomGoldPickup,
  expireCoinEvents,
};
