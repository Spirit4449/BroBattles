const {
  WORLD_BOUNDS,
  GAME_DURATION_MS,
  SD_DAMAGE_PER_SEC,
  TIMER_EMIT_INTERVAL_MS,
} = require("../gameRoomConfig");

function tickTimerAndSuddenDeath(room) {
  if (room.status !== "active") return;
  const now = Date.now();
  const elapsed = now - room._loopStartWallTime;
  const remaining = Math.max(0, GAME_DURATION_MS - elapsed);
  const suddenDeath = elapsed >= GAME_DURATION_MS;

  const sdElapsed = suddenDeath ? elapsed - GAME_DURATION_MS : 0;
  const worldBottomY = Number(WORLD_BOUNDS.height) || 1000;
  const poisonY = suddenDeath
    ? room._computePoisonY(sdElapsed)
    : worldBottomY + 60;

  if (suddenDeath && !room._suddenDeathActive) {
    room._suddenDeathActive = true;
    room.io.to(`game:${room.matchId}`).emit("game:sudden-death:start", {
      poisonY,
    });
    console.log(`[GameRoom ${room.matchId}] Sudden death started`);
  }

  if (room._suddenDeathActive) {
    const dmgPerTick = (SD_DAMAGE_PER_SEC * room.FIXED_DT_MS) / 1000;
    for (const p of room.players.values()) {
      if (!p.isAlive || p.connected === false || p.loaded !== true) continue;
      if (typeof p.y !== "number" || p.y < poisonY) continue;

      p.lastCombatAt = now;
      const old = p.health;
      p.health = Math.max(0, p.health - dmgPerTick);
      if (p.health !== old) {
        room._maybeBroadcastHealth(p, now);
        if (p.health <= 0) {
          p.isAlive = false;
          p.health = 0;
          room._broadcastHealthUpdate(p);
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
  }

  if (now - room._lastTimerEmitMs >= TIMER_EMIT_INTERVAL_MS) {
    room._lastTimerEmitMs = now;
    room.io.to(`game:${room.matchId}`).emit("game:timer", {
      elapsed,
      remaining,
      total: GAME_DURATION_MS,
      suddenDeath,
      poisonY,
    });
  }
}

function emitSnapshotWithTiming(room, snapMono) {
  const wall = Date.now();
  if (room._lastSnapshotMono > 0) {
    const spacing = snapMono - room._lastSnapshotMono;
    if (spacing >= 0) room._snapshotIntervals.push(spacing);
  }
  room._lastSnapshotMono = snapMono;
  room.broadcastSnapshot({
    tickId: room._tickId,
    tMono: snapMono,
    sentAtWallMs: wall,
  });
  if (room.DEV_TIMING_DIAG) {
    if (
      snapMono - room._diagLastLogMono >= 1000 &&
      room._snapshotIntervals.length
    ) {
      const arr = room._snapshotIntervals.slice(-60);
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const variance =
        arr.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / arr.length;
      const stdev = Math.sqrt(variance);
      console.log(
        `[GameRoom ${room.matchId}] timing tickId=${room._tickId} avgSpacing=${avg.toFixed(2)}ms stdev=${stdev.toFixed(2)}ms samples=${arr.length}`,
      );
      room._diagLastLogMono = snapMono;
    }
  }
}

module.exports = {
  tickTimerAndSuddenDeath,
  emitSnapshotWithTiming,
};
