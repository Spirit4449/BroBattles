const {
  WORLD_BOUNDS,
  GAME_DURATION_MS,
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
  POWERUP_PLATFORM_POINTS,
} = require("../gameRoomConfig");
const effectManager = require("./effects/effectManager");
const { effectDefs } = require("./effects/effectDefs");

function getPlatformSpawnPoints(room) {
  const mapId = Number(room.matchData?.map) || 1;
  const raw = POWERUP_PLATFORM_POINTS[mapId] || POWERUP_PLATFORM_POINTS[1];
  const points =
    Array.isArray(raw) && raw.length ? raw : POWERUP_PLATFORM_POINTS[1];
  return points
    .map((p) => ({
      x: Number(p?.x),
      y: Number(p?.y),
    }))
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
  if (room._powerups.size >= POWERUP_MAX_ACTIVE) return;
  const typeList =
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
  const type = pickPowerupType(room, typeList, point);
  if (!type) return;
  const now = Date.now();
  const powerup = {
    id: room._nextPowerupId++,
    type,
    x: point.x,
    y: point.y - POWERUP_SPAWN_Y_LIFT,
    _spawnPointKey: point._spawnPointKey,
    spawnedAt: now,
    activeAt: now + POWERUP_OMEN_MS,
    expiresAt: now + POWERUP_OMEN_MS + POWERUP_DESPAWN_MS,
  };
  room._powerups.set(powerup.id, powerup);
}

function computePoisonY(room, sdElapsedMs) {
  const worldBottomY = Number(WORLD_BOUNDS.height) || 1000;
  const earlySec = Math.min(sdElapsedMs, SD_RISE_FAST_PHASE_MS) / 1000;
  const lateSec = Math.max(0, sdElapsedMs - SD_RISE_FAST_PHASE_MS) / 1000;
  const rise =
    earlySec * SD_RISE_SPEED * SD_RISE_FAST_MULT + lateSec * SD_RISE_SPEED;
  return Math.max(0, worldBottomY - rise);
}

function isInSuddenDeathWater(room, playerData, nowTs) {
  if (!room._suddenDeathActive) return false;
  const elapsed = nowTs - room._loopStartWallTime;
  const sdElapsed = Math.max(0, elapsed - GAME_DURATION_MS);
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

  if (now - room._lastPowerupSpawnAt >= POWERUP_SPAWN_INTERVAL_MS) {
    room._lastPowerupSpawnAt = now;
    spawnPowerup(room);
  }

  for (const [id, pu] of room._powerups.entries()) {
    if (!pu || now >= (pu.expiresAt || 0)) {
      room._powerups.delete(id);
      continue;
    }
    if (now < Number(pu.activeAt || 0)) continue;
    for (const p of room.players.values()) {
      if (!p.isAlive || p.connected === false || p.loaded !== true) continue;
      const dx = (p.x || 0) - pu.x;
      const dy = (p.y || 0) - pu.y;
      if (Math.hypot(dx, dy) > POWERUP_PICKUP_RADIUS) continue;

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
    out[p.name] = effectManager.snapshotAll(p, now);
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
