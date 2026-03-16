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
  POWERUP_DURATIONS_MS,
  POWERUP_HEALTH_REGEN_PER_SEC,
  POWERUP_POISON_DPS,
  POWERUP_EFFECT_TICK_MS,
  POWERUP_AMBIENT_TICK_MS,
  POWERUP_PLATFORM_POINTS,
} = require("../gameRoomConfig");

function getPlatformSpawnPoints(room) {
  const mapId = Number(room.matchData?.map) || 1;
  const raw = POWERUP_PLATFORM_POINTS[mapId] || POWERUP_PLATFORM_POINTS[1];
  const points =
    Array.isArray(raw) && raw.length ? raw : POWERUP_PLATFORM_POINTS[1];
  const centerShiftX =
    (Number(WORLD_BOUNDS.width) || 1300) / 2 - POWERUP_LAYOUT_BASE_CENTER_X;
  return points.map((p) => ({
    x: (Number(p.x) || POWERUP_LAYOUT_BASE_CENTER_X) + centerShiftX,
    y: Number(p.y) || 300,
  }));
}

function pickSpawnPoint(room) {
  const points = getPlatformSpawnPoints(room);
  if (!points.length) return { x: 650, y: 300 };

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
  const now = Date.now();
  const powerup = {
    id: room._nextPowerupId++,
    type,
    x: Number(point.x) || 650,
    y: (Number(point.y) || 300) - POWERUP_SPAWN_Y_LIFT,
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
  if (!playerData || !playerData.effects) return;
  const effects = playerData.effects;
  const duration = POWERUP_DURATIONS_MS[type] || 5000;
  if (type === "rage") {
    effects.rageUntil = Math.max(effects.rageUntil || 0, nowTs + duration);
    if ((effects.rageNextTickAt || 0) <= nowTs) {
      effects.rageNextTickAt = nowTs + POWERUP_AMBIENT_TICK_MS;
    }
  } else if (type === "health") {
    const old = playerData.health;
    playerData.health = playerData.maxHealth;
    effects.healthUntil = Math.max(effects.healthUntil || 0, nowTs + duration);
    effects.healthNextTickAt = nowTs + POWERUP_EFFECT_TICK_MS;
    if (playerData.health !== old) room._broadcastHealthUpdate(playerData);
  } else if (type === "shield") {
    effects.shieldUntil = Math.max(effects.shieldUntil || 0, nowTs + duration);
  } else if (type === "poison") {
    effects.poisonUntil = Math.max(effects.poisonUntil || 0, nowTs + duration);
    effects.poisonNextTickAt = nowTs + POWERUP_EFFECT_TICK_MS;
  } else if (type === "gravityBoots") {
    effects.gravityUntil = Math.max(
      effects.gravityUntil || 0,
      nowTs + duration,
    );
    if ((effects.gravityNextTickAt || 0) <= nowTs) {
      effects.gravityNextTickAt = nowTs + POWERUP_AMBIENT_TICK_MS;
    }
  }
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
    if (
      !p.isAlive ||
      !p.effects ||
      p.connected === false ||
      p.loaded !== true
    ) {
      continue;
    }
    const e = p.effects;

    if ((e.poisonUntil || 0) > now && (e.poisonNextTickAt || 0) <= now) {
      e.poisonNextTickAt = now + POWERUP_EFFECT_TICK_MS;
      const old = p.health;
      const dmg = (POWERUP_POISON_DPS * POWERUP_EFFECT_TICK_MS) / 1000;
      p.health = Math.max(0, p.health - dmg);
      p.lastCombatAt = now;
      if (p.health !== old) {
        room._broadcastHealthUpdate(p);
        room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
          type: "poison",
          username: p.name,
        });
        if (p.health <= 0) {
          p.isAlive = false;
          room.io.to(`game:${room.matchId}`).emit("player:dead", {
            username: p.name,
            gameId: room.matchId,
          });
          try {
            room._checkVictoryCondition();
          } catch (_) {}
        }
      }
    }

    if ((e.healthUntil || 0) > now && (e.healthNextTickAt || 0) <= now) {
      e.healthNextTickAt = now + POWERUP_EFFECT_TICK_MS;
      if (!isInSuddenDeathWater(room, p, now)) {
        const old = p.health;
        const inc =
          (POWERUP_HEALTH_REGEN_PER_SEC * POWERUP_EFFECT_TICK_MS) / 1000;
        p.health = Math.min(p.maxHealth, p.health + inc);
        if (p.health !== old) {
          room._maybeBroadcastHealth(p, now);
          room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
            type: "health",
            username: p.name,
          });
        }
      }
    }

    if ((e.rageUntil || 0) > now && (e.rageNextTickAt || 0) <= now) {
      e.rageNextTickAt = now + POWERUP_AMBIENT_TICK_MS;
      room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
        type: "rage",
        username: p.name,
      });
    }

    if ((e.thorgRageUntil || 0) > now && (e.thorgRageNextTickAt || 0) <= now) {
      e.thorgRageNextTickAt =
        now + Math.max(700, POWERUP_AMBIENT_TICK_MS - 250);
      room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
        type: "thorgRage",
        username: p.name,
      });
    }

    if ((e.gravityUntil || 0) > now && (e.gravityNextTickAt || 0) <= now) {
      e.gravityNextTickAt = now + POWERUP_AMBIENT_TICK_MS;
      room.io.to(`game:${room.matchId}`).emit("powerup:tick", {
        type: "gravityBoots",
        username: p.name,
      });
    }
  }
}

function buildPlayerEffectsSnapshot(room) {
  const now = Date.now();
  const out = {};
  for (const p of room.players.values()) {
    const e = p.effects || {};
    out[p.name] = {
      rage: Math.max(0, (e.rageUntil || 0) - now),
      health: Math.max(0, (e.healthUntil || 0) - now),
      shield: Math.max(0, (e.shieldUntil || 0) - now),
      poison: Math.max(0, (e.poisonUntil || 0) - now),
      gravityBoots: Math.max(0, (e.gravityUntil || 0) - now),
      thorgRage: Math.max(0, (e.thorgRageUntil || 0) - now),
    };
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
