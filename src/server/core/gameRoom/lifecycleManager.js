const { ALL_DEAD_GAME_OVER_DELAY_MS } = require("../gameRoomConfig");
const effectManager = require("./effects/effectManager");

function potentialStartGame(room) {
  if (room.status !== "waiting") return;
  room.status = "starting";
  room._readyAcks = new Set();
  console.log(
    `[GameRoom ${room.matchId}] Entering starting phase (10s timeout)`,
  );

  room.io.to(`game:${room.matchId}`).emit("game:starting", {
    timeoutMs: 10000,
    at: Date.now(),
  });

  if (room._startTimeout) {
    try {
      clearTimeout(room._startTimeout);
    } catch (_) {}
  }
  room._startTimeout = setTimeout(() => {
    room._finalizeStart("timeout");
  }, 10000);
}

function finalizeStart(room, reason = "timeout") {
  if (room.status !== "starting") return;
  if (room._startTimeout) {
    try {
      clearTimeout(room._startTimeout);
    } catch (_) {}
    room._startTimeout = null;
  }
  const have = room._readyAcks?.size || 0;
  const need = room._requiredUserIds?.size || 0;
  console.log(
    `[GameRoom ${room.matchId}] Finalizing start (reason=${reason}) acks=${have}/${need}`,
  );
  room.startGame();
}

function startGame(room) {
  console.log(
    `[GameRoom ${room.matchId}] Starting game with ${room.players.size} players`,
  );

  room.status = "active";

  void room._broadcastParticipantStatus("In Battle");

  room.initializeSpawnPositions();
  try {
    room.gameMode?.onStart?.();
  } catch (e) {
    console.warn(`[GameRoom ${room.matchId}] mode onStart failed`, e?.message);
  }

  room.io.to(`game:${room.matchId}`).emit("game:start", {
    countdown: 6,
  });

  setTimeout(() => {
    const now = Date.now();
    for (const playerData of room.players.values()) {
      if (!playerData) continue;
      if (playerData.isBot) continue;
      effectManager.apply(
        playerData,
        "respawnShield",
        now,
        { durationMs: 3000 },
        room,
      );
      room.io.to(`game:${room.matchId}`).emit("player:respawn", {
        username: playerData.name,
        x: Number(playerData.x) || 0,
        y: Number(playerData.y) || 0,
        team: playerData.team,
        health: playerData.health,
        maxHealth: playerData.maxHealth,
        shieldMs: 3000,
        at: now,
      });
    }
    room.broadcastSnapshot();
    room.startGameLoop();
  }, 6000);
}

async function broadcastParticipantStatus(room, statusLabel) {
  if (!statusLabel) return;
  try {
    const participants = await room.db.runQuery(
      `SELECT mp.party_id, u.name
         FROM match_participants mp
         JOIN users u ON u.user_id = mp.user_id
        WHERE mp.match_id = ?`,
      [room.matchId],
    );
    for (const p of participants || []) {
      try {
        await room.db.setUserStatus(p.name, statusLabel);
      } catch (_) {}
      const pid = Number(p.party_id);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      room.io.to(`party:${pid}`).emit("status:update", {
        partyId: pid,
        name: p.name,
        status: statusLabel,
      });
    }
  } catch (e) {
    console.warn(
      `[GameRoom ${room.matchId}] failed to broadcast participant status`,
      e?.message,
    );
  }
}

function checkVictoryCondition(room) {
  if (room.status !== "active") return;
  const victoryState = room.gameMode?.evaluateVictoryState?.() || null;
  const terminal = victoryState?.terminal === true;
  const winner = terminal ? victoryState?.winnerTeam ?? null : null;

  if (!terminal) {
    if (room._pendingVictoryFinishTimeout) {
      clearTimeout(room._pendingVictoryFinishTimeout);
      room._pendingVictoryFinishTimeout = null;
      room._pendingVictoryOutcomeKey = null;
    }
    return;
  }

  const outcomeKey =
    victoryState?.outcomeKey != null
      ? String(victoryState.outcomeKey)
      : winner !== null
        ? String(winner)
        : "draw";

  if (
    room._pendingVictoryFinishTimeout &&
    room._pendingVictoryOutcomeKey === outcomeKey
  ) {
    return;
  }

  if (room._pendingVictoryFinishTimeout) {
    clearTimeout(room._pendingVictoryFinishTimeout);
  }

  room._pendingVictoryOutcomeKey = outcomeKey;
  const finishVictory = () => {
    room._pendingVictoryFinishTimeout = null;
    room._pendingVictoryOutcomeKey = null;
    if (room.status !== "active") return;

    const latestVictoryState = room.gameMode?.evaluateVictoryState?.() || null;
    if (!latestVictoryState?.terminal) {
      return;
    }

    room._finishGame(latestVictoryState.winnerTeam ?? null, {
      ...(latestVictoryState.meta || {}),
    });
  };

  const delayMs = Math.max(
    0,
    Number(victoryState?.meta?.finishDelayMs),
  );
  if (delayMs === 0) {
    finishVictory();
    return;
  }

  room._pendingVictoryFinishTimeout = setTimeout(
    finishVictory,
    delayMs || ALL_DEAD_GAME_OVER_DELAY_MS,
  );
}

async function finishGame(room, winnerTeam, meta = {}) {
  if (room.status === "finished") return;
  room.status = "finished";
  console.log(
    `[GameRoom ${room.matchId}] Game finished. Winner: ${winnerTeam || "draw"}`,
  );

  room._loopRunning = false;
  if (room._pendingVictoryFinishTimeout) {
    clearTimeout(room._pendingVictoryFinishTimeout);
    room._pendingVictoryFinishTimeout = null;
    room._pendingVictoryOutcomeKey = null;
  }
  if (room.gameLoop) {
    try {
      clearInterval(room.gameLoop);
    } catch (_) {}
    room.gameLoop = null;
  }

  try {
    try {
      await room.db.runQuery(
        "UPDATE matches SET status = 'completed', winner_team = ? WHERE match_id = ?",
        [winnerTeam, room.matchId],
      );
    } catch (error) {
      if (error?.code !== "ER_BAD_FIELD_ERROR") throw error;
      await room.db.runQuery(
        "UPDATE matches SET status = 'completed' WHERE match_id = ?",
        [room.matchId],
      );
    }
  } catch (e) {
    console.warn(
      `[GameRoom ${room.matchId}] failed to update match status`,
      e?.message,
    );
  }

  try {
    await room._broadcastParticipantStatus("End Screen");

    const participants = await room.db.runQuery(
      `SELECT mp.user_id, mp.party_id, u.name
         FROM match_participants mp
         JOIN users u ON u.user_id = mp.user_id
        WHERE mp.match_id = ?`,
      [room.matchId],
    );
    if (participants.length) {
      const userIds = participants
        .map((p) => Number(p.user_id))
        .filter((id) => Number.isFinite(id));
      if (userIds.length) {
        const placeholders = userIds.map(() => "?").join(",");
        await room.db.runQuery(
          `UPDATE users SET status='online' WHERE user_id IN (${placeholders})`,
          userIds,
        );
      }

      const partyIds = [
        ...new Set(
          participants
            .map((p) => Number(p.party_id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ];
      if (partyIds.length) {
        if (typeof room.db.setPartiesStatus === "function") {
          await room.db.setPartiesStatus(partyIds, "idle");
        } else {
          const ph = partyIds.map(() => "?").join(",");
          await room.db.runQuery(
            `UPDATE parties SET status='idle' WHERE party_id IN (${ph})`,
            partyIds,
          );
        }
      }

      for (const p of participants) {
        const pid = Number(p.party_id);
        if (!Number.isFinite(pid) || pid <= 0) continue;
        room.io.to(`party:${pid}`).emit("status:update", {
          partyId: pid,
          name: p.name,
          status: "online",
        });
      }
    }
  } catch (e) {
    console.warn(
      `[GameRoom ${room.matchId}] failed to reset post-match presence`,
      e?.message,
    );
  }

  let rewardSummary = [];
  try {
    rewardSummary = await room._distributeMatchRewards(winnerTeam);
  } catch (e) {
    console.warn(
      `[GameRoom ${room.matchId}] reward distribution failed`,
      e?.message,
    );
  }

  const finalMeta = { ...(meta || {}), rewards: rewardSummary };

  room.io.to(`game:${room.matchId}`).emit("game:over", {
    matchId: room.matchId,
    winnerTeam,
    meta: finalMeta,
  });

  setTimeout(() => {
    try {
      room.cleanup();
    } catch (_) {}
  }, 15000);
}

module.exports = {
  potentialStartGame,
  finalizeStart,
  startGame,
  broadcastParticipantStatus,
  checkVictoryCondition,
  finishGame,
};
