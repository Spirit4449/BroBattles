const {
  DEATH_DROP_DESPAWN_MS,
  DEATH_DROP_BLINK_MS,
  DEATH_DROP_PICKUP_RADIUS,
  DEATH_DROP_MAX_CLIENT_POS_DELTA,
  DEATH_DROP_COIN_MIN,
  DEATH_DROP_COIN_MAX,
  DEATH_DROP_GEM_MIN,
  DEATH_DROP_GEM_MAX,
  DEATH_DROP_LAUNCH_VX_STEP,
  DEATH_DROP_LAUNCH_VX_JITTER,
  DEATH_DROP_LAUNCH_VY_BASE,
  DEATH_DROP_LAUNCH_VY_JITTER,
  DEATH_DROP_LAUNCH_VY_SPREAD_BONUS,
} = require("../gameRoomConfig");

function randomInt(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function serializeDrop(drop) {
  if (!drop) return null;
  return {
    id: drop.id,
    type: drop.type,
    value: drop.value,
    x: drop.x,
    y: drop.y,
    spawnX: drop.spawnX,
    spawnY: drop.spawnY,
    vx: drop.vx,
    vy: drop.vy,
    spawnedAt: drop.spawnedAt,
    blinkAt: drop.blinkAt,
    expiresAt: drop.expiresAt,
    state: drop.state || "airborne",
  };
}

function buildDeathDropsSnapshot(room) {
  return Array.from(room._deathDrops.values())
    .map((drop) => serializeDrop(drop))
    .filter(Boolean);
}

function buildDropEntries() {
  const coinCount = randomInt(DEATH_DROP_COIN_MIN, DEATH_DROP_COIN_MAX);
  const gemCount = randomInt(DEATH_DROP_GEM_MIN, DEATH_DROP_GEM_MAX);
  return [
    ...Array.from({ length: coinCount }, () => ({ type: "coin", value: 1 })),
    ...Array.from({ length: gemCount }, () => ({ type: "gem", value: 1 })),
  ];
}

function spawnDeathDropsForPlayer(room, playerData, now = Date.now()) {
  if (!room || !playerData) return [];

  const entries = buildDropEntries();
  const total = entries.length;
  const spawnX = Number(playerData.x) || 0;
  const spawnY = Number(playerData.y) || 0;
  const drops = [];

  entries.forEach((entry, idx) => {
    const spreadIndex = idx - (total - 1) / 2;
    const vxJitter =
      Math.random() * DEATH_DROP_LAUNCH_VX_JITTER * 2 -
      DEATH_DROP_LAUNCH_VX_JITTER;
    const vyJitter = Math.random() * DEATH_DROP_LAUNCH_VY_JITTER;
    const drop = {
      id: room._nextDeathDropId++,
      type: entry.type,
      value: entry.value,
      x: spawnX,
      y: spawnY,
      spawnX,
      spawnY,
      vx: Math.round(spreadIndex * DEATH_DROP_LAUNCH_VX_STEP + vxJitter),
      vy: -Math.round(
        DEATH_DROP_LAUNCH_VY_BASE +
          Math.abs(spreadIndex) * DEATH_DROP_LAUNCH_VY_SPREAD_BONUS +
          vyJitter,
      ),
      spawnedAt: now,
      blinkAt: now + (DEATH_DROP_DESPAWN_MS - DEATH_DROP_BLINK_MS),
      expiresAt: now + DEATH_DROP_DESPAWN_MS,
      state: "airborne",
      ownerDeathUsername: playerData.name,
      claimedBy: null,
    };
    room._deathDrops.set(drop.id, drop);
    drops.push(drop);
  });

  return drops.map((drop) => serializeDrop(drop));
}

function tickDeathDrops(room) {
  if (!room?._deathDrops?.size) return;
  const now = Date.now();
  for (const [id, drop] of room._deathDrops.entries()) {
    if (!drop || now >= Number(drop.expiresAt || 0)) {
      room._deathDrops.delete(id);
    }
  }
}

function handlePlayerDeath(room, playerData, meta = {}) {
  if (!room || !playerData || playerData._deathHandled) return null;

  const at = Number(meta.at) || Date.now();
  playerData.isAlive = false;
  playerData.health = 0;
  playerData._deathHandled = true;

  const drops = spawnDeathDropsForPlayer(room, playerData, at);
  const payload = {
    username: playerData.name,
    character: playerData.char_class,
    x: Number(playerData.x) || 0,
    y: Number(playerData.y) || 0,
    at,
    cause: meta.cause || "combat",
    killedBy: meta.killedBy || null,
    drops,
    gameId: room.matchId,
  };

  room.io.to(`game:${room.matchId}`).emit("player:dead", payload);
  try {
    room._checkVictoryCondition();
  } catch (e) {
    console.warn(
      `[GameRoom ${room.matchId}] victory check failed after death`,
      e?.message,
    );
  }
  return payload;
}

function handleDeathDropPickup(room, socketId, payload) {
  if (!room || !payload || typeof payload !== "object") return;

  const playerData = room.players.get(socketId);
  if (
    !playerData ||
    !playerData.isAlive ||
    playerData.connected === false ||
    playerData.loaded !== true
  ) {
    return;
  }

  const id = Number(payload.id);
  if (!Number.isFinite(id)) return;
  const drop = room._deathDrops.get(id);
  if (!drop || drop.claimedBy) return;

  const now = Date.now();
  if (now >= Number(drop.expiresAt || 0)) {
    room._deathDrops.delete(id);
    return;
  }

  const clientX = Number(payload.x);
  const clientY = Number(payload.y);
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;

  const travelFromSpawn = Math.hypot(clientX - drop.spawnX, clientY - drop.spawnY);
  if (travelFromSpawn > DEATH_DROP_MAX_CLIENT_POS_DELTA) return;

  const playerX = Number(playerData.x) || 0;
  const playerY = Number(playerData.y) || 0;
  if (Math.hypot(playerX - clientX, playerY - clientY) > DEATH_DROP_PICKUP_RADIUS) {
    return;
  }

  drop.claimedBy = playerData.name;
  drop.x = clientX;
  drop.y = clientY;
  room._deathDrops.delete(id);

  const bucket = room._ensureRewardBucket(playerData);
  if (bucket) {
    if (drop.type === "coin") {
      bucket.dropCoins = (Number(bucket.dropCoins) || 0) + Number(drop.value || 1);
    } else if (drop.type === "gem") {
      bucket.dropGems = (Number(bucket.dropGems) || 0) + Number(drop.value || 1);
    }
  }

  room.io.to(`game:${room.matchId}`).emit("deathdrop:collected", {
    id: drop.id,
    type: drop.type,
    username: playerData.name,
    value: Number(drop.value) || 1,
    x: clientX,
    y: clientY,
    at: now,
  });
}

module.exports = {
  serializeDrop,
  buildDeathDropsSnapshot,
  spawnDeathDropsForPlayer,
  tickDeathDrops,
  handlePlayerDeath,
  handleDeathDropPickup,
};
