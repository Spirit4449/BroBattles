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
  POWERUP_RECENT_SPAWN_MEMORY,
  POWERUP_SPAWN_Y_LIFT,
  POWERUP_LAYOUT_BASE_CENTER_X,
  POWERUP_TYPES,
  POWERUP_PLATFORM_POINTS,
} = require("../gameRoomConfig");
const effectManager = require("./effects/effectManager");

function getPlatformSpawnPoints(room) {
  const mapId = Number(room.matchData?.map) || 1;
  const raw = POWERUP_PLATFORM_POINTS[mapId] || POWERUP_PLATFORM_POINTS[1];
  const points =
    Array.isArray(raw) && raw.length ? raw : POWERUP_PLATFORM_POINTS[1];
  const centerShiftX =
    (Number(WORLD_BOUNDS.width) || 1300) / 2 - POWERUP_LAYOUT_BASE_CENTER_X;
  return points
    .map((p) => ({
      x: Number(p?.x),
      y: Number(p?.y),
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({
      x: p.x + centerShiftX,
      y: p.y,
    }));
}

function pickSpawnPoint(room) {
  const points = getPlatformSpawnPoints(room);
  if (!points.length) return null;

  const activeIdxSet = new Set();
  for (const pu of room._powerups.values()) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dx = points[i].x - pu.x;
      const dy = points[i].y - pu.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) activeIdxSet.add(bestIdx);
  }

  const avoidRecent = new Set(room._recentPowerupSpawnIdx);
  const available = [];
  for (let i = 0; i < points.length; i++) {
    if (activeIdxSet.has(i)) continue;
    if (avoidRecent.has(i)) continue;
    available.push(i);
  }

  if (!available.length) {
    for (let i = 0; i < points.length; i++) {
      if (!activeIdxSet.has(i)) available.push(i);
    }
  }
  if (!available.length) {
    for (let i = 0; i < points.length; i++) available.push(i);
  }

  const idx = available[Math.floor(Math.random() * available.length)] ?? 0;
  room._recentPowerupSpawnIdx.push(idx);
  if (room._recentPowerupSpawnIdx.length > POWERUP_RECENT_SPAWN_MEMORY) {
    room._recentPowerupSpawnIdx.shift();
  }
  return points[idx];
}

function spawnPowerup(room) {
  if (room.status !== "active") return;
  if (room._powerups.size >= POWERUP_MAX_ACTIVE) return;
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
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
    expiresAt: now + POWERUP_DESPAWN_MS,
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

function applyPowerupToPlayer(room, playerData, type, nowTs) {
  if (!playerData) return;
  effectManager.apply(playerData, type, nowTs, {}, room);
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
    if (!p.isAlive || p.connected === false || p.loaded !== true) continue;
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
