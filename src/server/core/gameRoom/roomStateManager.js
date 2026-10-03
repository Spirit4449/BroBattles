const { damageHitboxSnapshot } = require('./damageHitboxes');
const effectManager = require('./effects/effectManager');
const { randomUUID } = require("node:crypto");
const { getDuelGeometry, spawnForParticipant } = require('../../../shared/duelGeometry');

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
    playerEffectMovement: Object.fromEntries(Array.from(room.players.values(), player => {
      const { speedMult, jumpMult } = effectManager.getModifiers(player, Date.now());
      return [player.name, { speedMult, jumpMult }];
    })),
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
    const geometry = room.geometry || getDuelGeometry(room.matchData.map);
    if (geometry) {
      const teamSize = room.matchData.players.filter(mp => mp.team === p.team).length;
      Object.assign(p, spawnForParticipant(geometry, p, spawnIndex, teamSize), { vx: 0, vy: 0, grounded: true });
    }
    require("./inputManager").resetMovementBudget(p);
    require("./inputManager").updateBodyGeometry(p, room);
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
    ...require('./characterCombatRegistry').bootstrap(room),
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
        participantId: mp.participantId,
        user_id: mp.user_id,
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
        wallSliding: !!p?.wallSliding,
        wallSide: p?.wallSide || null,
        dashSeq: p?.dashSeq || 0, dashX: p?.dashX || 0, dashY: p?.dashY || 0,
        movementFxSeq: Number(p?.movementFxSeq) || 0,
        movementFxType: p?.movementFxType || null,
        movementFxDirection: Number(p?.movementFxDirection) || 0,
        movementFxWallSide: p?.movementFxWallSide || null,
        movementFxFallDistance: Number(p?.movementFxFallDistance) || 0,
        movementFxImpactVelocity: Number(p?.movementFxImpactVelocity) || 0,
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
        // null means the participant has not joined this room yet. The client
        // can then retain the authoritative level from its HTTP roster.
        level: Number.isFinite(p?.level) ? p.level : null,
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

  socket.emit("game:init", gameStateForPlayer);
}

// Movement VFX events (jump/land/turn/wall-jump) change a few times a second at
// most. movementFxSeq is always sent (clients use its presence to tell event-ID
// senders from legacy ones); the five detail fields are published only for a
// short window after each new event, which survives same-instant replacement
// and buffer trimming, instead of repeating them in every 30 Hz snapshot.
const MOVEMENT_FX_PUBLISH_MS = 500;
function shouldPublishMovementFx(playerData, now) {
  const seq = Number(playerData.movementFxSeq) || 0;
  if (seq !== playerData._publishedMovementFxSeq) {
    playerData._publishedMovementFxSeq = seq;
    playerData._movementFxPublishUntil = seq ? now + MOVEMENT_FX_PUBLISH_MS : 0;
  }
  return now < (Number(playerData._movementFxPublishUntil) || 0);
}

function broadcastSnapshot(room, extraTiming = null) {
  const sentMono = performance.now();
  const wall = Date.now();
  const tMono = extraTiming?.tMono ?? room._simulationMono ?? sentMono;
  // Several state changes can occur in one simulation tick. Order emissions
  // independently, without inventing elapsed simulation time for those changes.
  room._snapshotSeq = (room._snapshotSeq || 0) + 1;
  room._snapshotEpoch ??= randomUUID();

  const snapshot = {
    timestamp: wall,
    sentAtWallMs: wall,
    sentMono,
    tMono,
    tickId: room._tickId || 0,
    snapshotSeq: room._snapshotSeq,
    snapshotEpoch: room._snapshotEpoch,
    snapshotKind: extraTiming ? "periodic" : "event",
    players: {},
  };

  if (room.matchData?.editorDebugHitboxes) snapshot.damageHitboxes = damageHitboxSnapshot(room, wall);

  for (const playerData of room.players.values()) {
    const playerSnapshot = {
      participantId: playerData.participantId,
      isBot: playerData.isBot === true,
      x: roundPosition(playerData.x),
      y: roundPosition(playerData.y),
      vx: roundVelocity(playerData.vx),
      vy: roundVelocity(playerData.vy),
      grounded: !!playerData.grounded,
      ducking: !!playerData.ducking && !!playerData.grounded,
      wallSliding: !!playerData.wallSliding,
      dashSeq: playerData.dashSeq || 0, dashX: playerData.dashX || 0, dashY: playerData.dashY || 0,
      movementFxSeq: Number(playerData.movementFxSeq) || 0,
      flip: !!playerData.flip,
      animation: playerData.animation || null,
      health: playerData.health,
      isAlive: playerData.isAlive,
      connected: playerData.connected !== false,
      loaded: playerData.loaded === true,
    };

    if (playerData.wallSliding && playerData.wallSide) {
      playerSnapshot.wallSide = playerData.wallSide;
    }
    if (shouldPublishMovementFx(playerData, wall)) {
      Object.assign(playerSnapshot, {
        movementFxType: playerData.movementFxType || null,
        movementFxDirection: Number(playerData.movementFxDirection) || 0,
        movementFxWallSide: playerData.movementFxWallSide || null,
        movementFxFallDistance: Number(playerData.movementFxFallDistance) || 0,
        movementFxImpactVelocity:
          Number(playerData.movementFxImpactVelocity) || 0,
      });
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
