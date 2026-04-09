const RANDOM_GOLD_PICKUP_CAP = 6;
const RANDOM_GOLD_PICKUP_VALUE = 10;
const RANDOM_GOLD_PICKUP_RADIUS = 42;
const RANDOM_GOLD_SPAWN_INTERVAL_MS = 3200;
const COLLECTION_EVENT_RETENTION_MS = 1800;

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
      yieldAmount: Math.max(1, Number(def?.yieldAmount) || 15),
      yieldIntervalMs: Math.max(500, Number(def?.yieldIntervalMs) || 3500),
      maxStoredGold: Math.max(1, Number(def?.maxStoredGold) || 60),
      radius: Math.max(20, Number(def?.radius) || 80),
    };
  } else if (base.type === "claimableTurret") {
    base.state = {
      claimedByTeam: null,
      claimRadius: Math.max(40, Number(def?.claimRadius) || 110),
      claimCost: Math.max(0, Number(def?.claimCost) || 120),
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
      cost: Math.max(0, Number(def?.cost) || 90),
      width: Math.max(10, Number(def?.width) || 120),
      height: Math.max(10, Number(def?.height) || 46),
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
  };
}

function expireCollectionEvents(events = [], now = Date.now()) {
  return Array.isArray(events)
    ? events.filter(
        (entry) =>
          now - (Number(entry?.at) || 0) <= COLLECTION_EVENT_RETENTION_MS,
      )
    : [];
}

module.exports = {
  RANDOM_GOLD_PICKUP_CAP,
  RANDOM_GOLD_PICKUP_VALUE,
  RANDOM_GOLD_PICKUP_RADIUS,
  RANDOM_GOLD_SPAWN_INTERVAL_MS,
  createBankBustObjects,
  createRandomGoldState,
  serializeModeObject,
  serializeRandomGoldPickup,
  expireCollectionEvents,
};
