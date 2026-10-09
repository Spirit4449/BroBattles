const { PICKUP_DELAY_MS } = require("../../../shared/powerups");
const {
  SD_RISE_SPEED,
  SD_RISE_FAST_PHASE_MS,
  SD_RISE_FAST_MULT,
  POWERUP_SPAWN_INTERVAL_MS,
  POWERUP_MAX_ACTIVE,
  POWERUP_PICKUP_RADIUS,
  POWERUP_DESPAWN_MS,
  POWERUP_OMEN_MS,
  POWERUP_SPAWN_Y_LIFT,
  POWERUP_TYPE_ROTATION,
} = require("../gameRoomConfig");
const { getDuelGeometry } = require("../../../shared/physics/duelGeometry");
const { resolvePowerupPoints } = require("../../../shared/maps/mapDocument");
const effectManager = require("./effects/effectManager");
const { powerupGap } = require("./powerupContact");
const { matchDurationMs } = require("./timerManager");
const { effectDefs } = require("./effects/effectDefs");

// Spawn points come from the map document (`spawns.powerups`, edited in the
// map editor). Rooms without map geometry fall back to the shipped map file.
function getPlatformSpawnPoints(room) {
  const geometry = room.geometry?.spawns?.powerups
    ? room.geometry
    : getDuelGeometry(Number(room.matchData?.map) || 1) || getDuelGeometry(1);
  return resolvePowerupPoints(geometry)
    .map((p) => ({ ...p, x: Number(p?.x), y: Number(p?.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function randomForRoom(room) {
  const value =
    typeof room?._powerupRandom === "function"
      ? Number(room._powerupRandom())
      : Math.random();
  if (!Number.isFinite(value)) return Math.random();
  return Math.max(0, Math.min(0.999999999, value));
}

function shuffledCopy(room, values) {
  const copy = Array.isArray(values) ? values.slice() : [];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomForRoom(room) * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function spawnPointKey(point) {
  return `${Number(point?.x)},${Number(point?.y)}`;
}

function activeSpawnPointKeys(room) {
  const active = new Set();
  for (const powerup of room?._powerups?.values?.() || []) {
    if (powerup?._spawnPointKey) {
      active.add(powerup._spawnPointKey);
      continue;
    }
    const x = Number(powerup?.x);
    const y = Number(powerup?.y) + POWERUP_SPAWN_Y_LIFT;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      active.add(spawnPointKey({ x, y }));
    }
  }
  return active;
}

function pickSpawnPoint(room) {
  const points = getPlatformSpawnPoints(room);
  if (!points.length) return null;

  const pointsByKey = new Map(points.map((point) => [spawnPointKey(point), point]));
  const allKeys = Array.from(pointsByKey.keys());
  const activeKeys = activeSpawnPointKeys(room);
  const recentLimit = Math.min(3, Math.max(0, points.length - 1));
  const recentKeys = recentLimit > 0 && Array.isArray(room._recentPowerupSpawnKeys)
    ? room._recentPowerupSpawnKeys.slice(-recentLimit)
    : [];
  const recentSet = new Set(recentKeys);

  let eligibleKeys = allKeys.filter((key) => !activeKeys.has(key));
  const withoutRecent = eligibleKeys.filter((key) => !recentSet.has(key));
  if (withoutRecent.length) eligibleKeys = withoutRecent;
  if (!eligibleKeys.length) return null;

  const validKeySet = new Set(allKeys);
  let bag = Array.isArray(room._powerupSpawnBag)
    ? room._powerupSpawnBag.filter((key) => validKeySet.has(key))
    : [];
  let bagIndex = bag.findIndex((key) => eligibleKeys.includes(key));
  if (bagIndex < 0) {
    bag = shuffledCopy(room, allKeys);
    bagIndex = bag.findIndex((key) => eligibleKeys.includes(key));
  }

  const selectedKey =
    bagIndex >= 0
      ? bag.splice(bagIndex, 1)[0]
      : eligibleKeys[Math.floor(randomForRoom(room) * eligibleKeys.length)];
  room._powerupSpawnBag = bag;
  room._recentPowerupSpawnKeys =
    recentLimit > 0
      ? [...recentKeys, selectedKey].slice(-recentLimit)
      : [];

  const selected = pointsByKey.get(selectedKey);
  return selected ? { ...selected, _spawnPointKey: selectedKey } : null;
}

function pickPowerupType(room, typeList, point = null) {
  const types = Array.from(new Set(typeList || [])).filter(Boolean);
  if (!types.length) return null;

  const spawnKey = point?._spawnPointKey || spawnPointKey(point);
  const lastAtPoint = room._lastPowerupTypeBySpawnKey?.[spawnKey] || null;
  const lastOverall = room._lastPowerupType || null;
  const validTypes = new Set(types);
  let bag = Array.isArray(room._powerupTypeBag)
    ? room._powerupTypeBag.filter((type) => validTypes.has(type))
    : [];
  if (!bag.length) bag = shuffledCopy(room, types);

  let index = bag.findIndex(
    (type) => type !== lastOverall && type !== lastAtPoint,
  );
  if (index < 0) index = bag.findIndex((type) => type !== lastOverall);
  if (index < 0) index = 0;

  const type = bag.splice(index, 1)[0] || types[0];
  room._powerupTypeBag = bag;
  room._lastPowerupType = type;
  if (!room._lastPowerupTypeBySpawnKey) {
    room._lastPowerupTypeBySpawnKey = Object.create(null);
  }
  room._lastPowerupTypeBySpawnKey[spawnKey] = type;
  return type;
}

function spawnPowerup(room) {
  if (room.status !== "active") return;
  if (room._powerups.size >= (room.geometry?.settings?.maxActive ?? POWERUP_MAX_ACTIVE)) return;
  const typeList = room.geometry?.settings?.types ||
    Array.isArray(POWERUP_TYPE_ROTATION) && POWERUP_TYPE_ROTATION.length
      ? POWERUP_TYPE_ROTATION
    : [
        "rage",
        "health",
        "shield",
        "poison",
        "gravityBoots",
        "invisibility",
        "shockwave",
        "freeze",
      ];
  const point = pickSpawnPoint(room);
  if (!point) {
    console.warn(
      `[GameRoom ${room.matchId}] Skipping powerup spawn: no valid platform spawn points for map ${room.matchData?.map}`,
    );
    return;
  }
  const type = pickPowerupType(room, point.type ? [point.type] : typeList, point);
  if (!type) return;
  const now = Date.now();
  const powerup = {
    id: room._nextPowerupId++,
    type,
    x: point.x,
    y: point.freePosition ? point.y : point.y - (room.geometry?.settings?.spawnLift ?? POWERUP_SPAWN_Y_LIFT),
    _spawnPointKey: point._spawnPointKey,
    spawnedAt: now,
    activeAt: now + (room.geometry?.settings?.omenMs ?? POWERUP_OMEN_MS),
    expiresAt: now + (room.geometry?.settings?.omenMs ?? POWERUP_OMEN_MS) + (room.geometry?.settings?.despawnMs ?? POWERUP_DESPAWN_MS),
  };
  room._powerups.set(powerup.id, powerup);
}

function computePoisonY(room, sdElapsedMs) {
  const world = room.geometry.world;
  const worldBottomY = world.y + world.height;
  const earlySec = Math.min(sdElapsedMs, SD_RISE_FAST_PHASE_MS) / 1000;
  const lateSec = Math.max(0, sdElapsedMs - SD_RISE_FAST_PHASE_MS) / 1000;
  const rise =
    earlySec * SD_RISE_SPEED * SD_RISE_FAST_MULT + lateSec * SD_RISE_SPEED;
  return Math.max(world.y, worldBottomY - rise);
}

function isInSuddenDeathWater(room, playerData, nowTs) {
  if (!room._suddenDeathActive) return false;
  const elapsed = nowTs - room._loopStartWallTime;
  // Same regulation length the timer uses, so heal-blocking matches the poison.
  const sdElapsed = Math.max(0, elapsed - matchDurationMs(room));
  const poisonY = computePoisonY(room, sdElapsed);
  return typeof playerData?.y === "number" && playerData.y >= poisonY;
}

function applyPowerupToPlayer(room, playerData, type, nowTs, params = null) {
  if (!playerData) return;
  const durationScale = Number(params?.durationScale);
  const nextParams = params && typeof params === "object" ? { ...params } : {};
  if (Number.isFinite(durationScale) && durationScale > 0) {
    const baseDuration = Number(effectDefs?.[type]?.durationMs);
    if (Number.isFinite(baseDuration) && baseDuration > 0) {
      nextParams.durationMs = Math.round(baseDuration * durationScale);
    }
  }
  effectManager.apply(playerData, type, nowTs, nextParams, room);
}

function tickPowerups(room) {
  if (room.status !== "active") return;
  const now = Date.now();

  if (now - room._lastPowerupSpawnAt >= (room.geometry?.settings?.spawnIntervalMs ?? POWERUP_SPAWN_INTERVAL_MS)) {
    room._lastPowerupSpawnAt = now;
    spawnPowerup(room);
  }

  for (const [id, pu] of room._powerups.entries()) {
    if (!pu || now >= (pu.expiresAt || 0)) {
      room._powerups.delete(id);
      continue;
    }
    if (now < Number(pu.activeAt ?? pu.spawnedAt ?? 0) + PICKUP_DELAY_MS) continue;
    for (const p of room.players.values()) {
      if (!p.isAlive || p.connected === false || p.loaded !== true) continue;
      if (powerupGap(p, pu, p, room.geometry?.settings?.pickupRadius ?? POWERUP_PICKUP_RADIUS) > 0) continue;

      applyPowerupToPlayer(room, p, pu.type, now);
      room._powerups.delete(id);
      room.io.to(`game:${room.matchId}`).emit("powerup:collected", {
        id: pu.id,
        type: pu.type,
        username: p.name,
        x: pu.x,
        y: pu.y,
        at: now,
      });
      break;
    }
  }
}

function tickPowerupEffects(room) {
  if (room.status !== "active") return;
  const now = Date.now();
  for (const p of room.players.values()) {
    if (!p.isAlive || p.loaded !== true) continue;
    effectManager.tickAll(p, room, now);
  }
}

function buildPlayerEffectsSnapshot(room) {
  const now = Date.now();
  const out = {};
  for (const p of room.players.values()) {
    out[p.name] = effectManager.snapshotActive(p, now);
  }
  return out;
}

module.exports = {
  getPlatformSpawnPoints,
  pickSpawnPoint,
  pickPowerupType,
  spawnPowerup,
  computePoisonY,
  isInSuddenDeathWater,
  applyPowerupToPlayer,
  tickPowerups,
  tickPowerupEffects,
  buildPlayerEffectsSnapshot,
};
