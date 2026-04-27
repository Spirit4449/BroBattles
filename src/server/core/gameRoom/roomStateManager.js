function roundPosition(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 2) / 2;
}

function roundVelocity(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function buildWorldStatePayload(room) {
  return {
    timestamp: Date.now(),
    modeState: room.gameMode?.buildModeState?.() ?? null,
    powerups: Array.from(room._powerups.values()).map((pu) => ({
      id: pu.id,
      type: pu.type,
      x: pu.x,
      y: pu.y,
      spawnedAt: pu.spawnedAt,
      activeAt: pu.activeAt,
      expiresAt: pu.expiresAt,
    })),
    deathDrops: room._buildDeathDropsSnapshot(),
    playerEffects: room._buildPlayerEffectsSnapshot(),
  };
}

function computeSpawnIndex(room, name, team) {
  try {
    const teamList = (room.matchData.players || [])
      .filter((p) => p.team === team)
      .map((p) => ({ name: p.name }));
    return Math.max(
      0,
      teamList.findIndex((p) => p.name === name),
    );
  } catch (_) {
    return 0;
  }
}

function initializeSpawnPositions(room) {
  for (const p of room.players.values()) {
    const spawnIndex = computeSpawnIndex(room, p.name, p.team);
    p.spawnIndex = spawnIndex;
    p.loaded =
      p.loaded === true ||
      (p._sceneReady === true && Number.isFinite(p.x) && Number.isFinite(p.y));
  }
}

function sendGameStateToPlayer(room, socket) {
  const playerData = room.players.get(socket.id);
  if (!playerData) return;

  const liveByName = new Map();
  for (const p of room.players.values()) {
    if (!p?.name) continue;
    liveByName.set(p.name, p);
  }

  const gameStateForPlayer = {
    matchId: room.matchId,
    mode: room.matchData.mode,
    modeId: room.matchData.modeId || "duels",
    modeVariantId: room.matchData.modeVariantId || null,
    map: room.matchData.map,
    yourTeam: playerData.team,
    yourCharacter: playerData.char_class,
    spawnVersion: room.spawnVersion,
    ...buildWorldStatePayload(room),
    players: (room.matchData.players || []).map((mp) => {
      const p = liveByName.get(mp.name);
      return {
        name: mp.name,
        team: mp.team,
        char_class: p?.char_class || mp.char_class,
        selected_skin_id: p?.selected_skin_id || mp.selected_skin_id || null,
        selected_skin_asset_url:
          p?.selected_skin_asset_url || mp.selected_skin_asset_url || null,
        selected_skin_game_assets:
          p?.selected_skin_game_assets || mp.selected_skin_game_assets || null,
        x: roundPosition(p?.x),
        y: roundPosition(p?.y),
        vx: Number.isFinite(p?.vx) ? p.vx : 0,
        vy: Number.isFinite(p?.vy) ? p.vy : 0,
        grounded: !!p?.grounded,
        health: Number.isFinite(p?.health) ? p.health : null,
        superCharge: Number.isFinite(p?.superCharge) ? p.superCharge : 0,
        maxSuperCharge: Number.isFinite(p?.maxSuperCharge)
          ? p.maxSuperCharge
          : 100,
        stats: {
          health: Number.isFinite(p?.maxHealth) ? p.maxHealth : null,
          damage: Number.isFinite(p?.baseDamage) ? p.baseDamage : null,
          specialDamage: Number.isFinite(p?.specialDamage)
            ? p.specialDamage
            : null,
        },
        level: Number.isFinite(p?.level) ? p.level : 1,
        isAlive: p ? p.isAlive !== false : true,
        isBot: p ? p.isBot === true : mp?.isBot === true,
        spawnIndex: computeSpawnIndex(room, mp.name, mp.team),
        connected: p ? p.connected !== false : false,
        loaded: p ? p.loaded === true : false,
        ammoState: p?.ammoState || null,
      };
    }),
    status: room.status,
  };

  console.log("Emitting initial game state to player", gameStateForPlayer);
  socket.emit("game:init", gameStateForPlayer);
}

function broadcastSnapshot(room, extraTiming = null) {
  const { USE_SERVER_MOVEMENT_SIMULATION_V1 } = require("../gameRoomConfig");

  const snapshot = {
    timestamp: Date.now(),
    players: {},
  };

  if (extraTiming) {
    snapshot.tickId = extraTiming.tickId;
    snapshot.tMono = extraTiming.tMono;
    snapshot.sentAtWallMs = extraTiming.sentAtWallMs;
  }

  for (const playerData of room.players.values()) {
    const playerSnapshot = {
      x: roundPosition(playerData.x),
      y: roundPosition(playerData.y),
      vx: roundVelocity(playerData.vx),
      vy: roundVelocity(playerData.vy),
      grounded: !!playerData.grounded,
      flip: !!playerData.flip,
      animation: playerData.animation || null,
      health: playerData.health,
      isAlive: playerData.isAlive,
      connected: playerData.connected !== false,
      loaded: playerData.loaded === true,
    };

    // PHASE 2: Add optional diagnostic fields for server-side movement simulation
    // (ignore if old client; only populated when flag enabled)
    if (USE_SERVER_MOVEMENT_SIMULATION_V1) {
      if (typeof playerData._simX === "number")
        playerSnapshot.simX = playerData._simX;
      if (typeof playerData._simY === "number")
        playerSnapshot.simY = playerData._simY;
      if (typeof playerData._lastInputSeq === "number")
        playerSnapshot.inputSeq = playerData._lastInputSeq;
    }

    snapshot.players[playerData.name] = playerSnapshot;
  }

  room.io
    .to(`game:${room.matchId}`)
    .compress(false)
    .emit("game:snapshot", snapshot);
}

function broadcastWorldState(room) {
  room.io
    .to(`game:${room.matchId}`)
    .compress(false)
    .emit("game:state", buildWorldStatePayload(room));
}

module.exports = {
  buildWorldStatePayload,
  computeSpawnIndex,
  initializeSpawnPositions,
  sendGameStateToPlayer,
  broadcastSnapshot,
  broadcastWorldState,
};
