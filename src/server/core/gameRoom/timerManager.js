const { exposeDamageHitbox } = require('./damageHitboxes');
const {
  WORLD_BOUNDS,
  GAME_DURATION_MS,
  SD_DAMAGE_PER_SEC,
  SUDDEN_DEATH_MAX_MS,
  TIMER_EMIT_INTERVAL_MS,
} = require("../gameRoomConfig");
const netTestLogger = require("./netTestLogger");

// Regulation length; sudden death (when the mode supports it) starts after it.
function matchDurationMs(room) {
  return Math.max(
    1000,
    Number(room.gameMode?.getMatchDurationMs?.()) || GAME_DURATION_MS,
  );
}

function decideSuddenDeathWinner(room) {
  const teams = {
    team1: { alive: 0, health: 0, damage: 0 },
    team2: { alive: 0, health: 0, damage: 0 },
  };

  for (const p of room.players.values()) {
    if (!p || (p.team !== "team1" && p.team !== "team2")) continue;
    const team = teams[p.team];
    if (p.isAlive) team.alive += 1;
    team.health += Math.max(0, Number(p.health) || 0);
  }

  for (const bucket of room.rewardStats?.values?.() || []) {
    if (!bucket || (bucket.team !== "team1" && bucket.team !== "team2")) continue;
    teams[bucket.team].damage += Math.max(0, Number(bucket.damage) || 0);
  }

  if (teams.team1.alive !== teams.team2.alive) {
    return {
      winnerTeam: teams.team1.alive > teams.team2.alive ? "team1" : "team2",
      reason: "alive",
      teams,
    };
  }
  if (teams.team1.health !== teams.team2.health) {
    return {
      winnerTeam: teams.team1.health > teams.team2.health ? "team1" : "team2",
      reason: "health",
      teams,
    };
  }
  if (teams.team1.damage !== teams.team2.damage) {
    return {
      winnerTeam: teams.team1.damage > teams.team2.damage ? "team1" : "team2",
      reason: "damage",
      teams,
    };
  }
  return { winnerTeam: null, reason: "draw", teams };
}

function tickTimerAndSuddenDeath(room) {
  if (room.status !== "active") return;
  const now = Date.now();
  const elapsed = now - room._loopStartWallTime;
  const totalDurationMs = matchDurationMs(room);
  const shouldUseSuddenDeath = room.gameMode?.supportsSuddenDeath?.() !== false;
  const remaining = Math.max(0, totalDurationMs - elapsed);
  const suddenDeath = shouldUseSuddenDeath && elapsed >= totalDurationMs;

  const sdElapsed = suddenDeath ? elapsed - totalDurationMs : 0;
  const worldBottomY = room.geometry?.world ? room.geometry.world.y + room.geometry.world.height : WORLD_BOUNDS.height;
  const poisonY = suddenDeath
    ? room._computePoisonY(sdElapsed)
    : worldBottomY + 60;

  if (!shouldUseSuddenDeath && elapsed >= totalDurationMs) {
    const outcome = room.gameMode?.onTimerExpired?.() || null;
    if (outcome?.terminal) {
      room._finishGame(outcome.winnerTeam ?? null, {
        ...(outcome.meta || {}),
      });
      return;
    }
  }

  if (suddenDeath && !room._suddenDeathActive) {
    room._suddenDeathActive = true;
    room.io.to(`game:${room.matchId}`).emit("game:sudden-death:start", {
      poisonY,
    });
    console.log(`[GameRoom ${room.matchId}] Sudden death started`);
  }

  if (room._suddenDeathActive) {
    if (sdElapsed >= SUDDEN_DEATH_MAX_MS) {
      const outcome = decideSuddenDeathWinner(room);
      room._finishGame(outcome.winnerTeam, {
        suddenDeathTimeout: true,
        tiebreakReason: outcome.reason,
        team1Alive: outcome.teams.team1.alive,
        team2Alive: outcome.teams.team2.alive,
        team1Health: outcome.teams.team1.health,
        team2Health: outcome.teams.team2.health,
        team1Damage: outcome.teams.team1.damage,
        team2Damage: outcome.teams.team2.damage,
      });
      return;
    }

    const world = room.geometry?.world || { x: 0, width: WORLD_BOUNDS.width, y: 0, height: WORLD_BOUNDS.height };
    exposeDamageHitbox(room, { id: 'sudden-death-poison' }, { kind: 'rect', left: world.x, right: world.x + world.width, top: poisonY, bottom: Math.max(poisonY, world.y + world.height) }, now);
    const dmgPerTick = (SD_DAMAGE_PER_SEC * room.FIXED_DT_MS) / 1000;
    for (const p of room.players.values()) {
      if (!p.isAlive || p.loaded !== true) continue;
      if (typeof p.y !== "number" || p.y < poisonY) continue;

      p.lastCombatAt = now;
      const old = p.health;
      p.health = Math.max(0, p.health - dmgPerTick);
      if (p.health !== old) {
        room._maybeBroadcastHealth(p, now, { cause: "poison" });
        if (p.health <= 0) {
          p.health = 0;
          room._broadcastHealthUpdate(p, { cause: "poison" });
          room._handlePlayerDeath(p, { cause: "poison", at: now });
        }
      }
    }
  }

  if (now - room._lastTimerEmitMs >= TIMER_EMIT_INTERVAL_MS) {
    room._lastTimerEmitMs = now;
    room.io.to(`game:${room.matchId}`).emit("game:timer", {
      elapsed,
      remaining,
      total: totalDurationMs,
      suddenDeath,
      poisonY,
    });
  }
}

// Snapshot spacing statistics live in timingDiagnostics (noted by the caller).
function emitSnapshotWithTiming(room, snapMono) {
  room.broadcastSnapshot({
    tickId: room._tickId,
    tMono: snapMono,
  });
  netTestLogger.noteSnapshot(room, snapMono);
}

module.exports = {
  matchDurationMs,
  tickTimerAndSuddenDeath,
  emitSnapshotWithTiming,
};
