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

function pickSpawnPoint(room) {
  const points = getPlatformSpawnPoints(room);
  if (!points.length) return null;
  const idx = room._nextPowerupSpawnPointIdx % points.length;
  room._nextPowerupSpawnPointIdx += 1;
  return points[idx];
}

function spawnPowerup(room) {
  if (room.status !== "active") return;
  if (room._powerups.size >= POWERUP_MAX_ACTIVE) return;
  const typeList =
    Array.isArray(POWERUP_TYPE_ROTATION) && POWERUP_TYPE_ROTATION.length
      ? POWERUP_TYPE_ROTATION
      : ["rage", "health", "shield", "poison", "gravityBoots"];
  const type = typeList[room._nextPowerupTypeIdx % typeList.length];
  room._nextPowerupTypeIdx += 1;
  const point = pickSpawnPoint(room);
  if (!point) {
    console.warn(
      `[GameRoom ${room.matchId}] Skipping powerup spawn: no valid platform spawn points for map ${room.matchData?.map}`,
    );
    return;
  }
  const now = Date.now();
  const powerup = {
    id: room._nextPowerupId++,
    type,
    x: point.x,
    y: point.y - POWERUP_SPAWN_Y_LIFT,
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
  spawnPowerup,
  computePoisonY,
  isInSuddenDeathWater,
  applyPowerupToPlayer,
  tickPowerups,
  tickPowerupEffects,
  buildPlayerEffectsSnapshot,
};
