const { deleteMatchBots } = require("../../services/matchRosterService");
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
    `[GameRoom ${room.matchId}] Starting game with ${room.getPlayerCount()} connected players`,
  );

  room.status = "active";

  room.initializeSpawnPositions();
  for (const p of room.players.values()) p._controlLockUntil = Date.now() + 6000;
  try {
    room.gameMode?.onStart?.();
  } catch (e) {
    console.warn(`[GameRoom ${room.matchId}] mode onStart failed`, e?.message);
  }

  room.io.to(`game:${room.matchId}`).emit("game:start", {
    countdown: 6,
    spawns: Object.fromEntries(Array.from(room.players.values(), p => [p.name, { x: p.x, y: p.y }])),
  });

  room._countdownTimeout = setTimeout(() => {
    if (room._disposed || room.status !== "active") return;
    room._countdownTimeout = null;
    try {
      const now = Date.now();
      console.log(
        `[GameRoom ${room.matchId}] Countdown finished, bootstrapping live loop`,
        {
          players: room.players.size,
          connectedPlayers: room.getPlayerCount(),
          readyAcks: room._readyAcks?.size || 0,
          requiredReadyAcks: room._requiredUserIds?.size || 0,
        },
      );
      for (const playerData of room.players.values()) {
        if (!playerData) continue;

        effectManager.apply(
          playerData,
          "respawnShield",
          now,
          { durationMs: 3000 },
          room,
        );
      }
      room.broadcastWorldState();
      room.broadcastSnapshot();
      room.startGameLoop();
    } catch (error) {
      console.warn(
        `[GameRoom ${room.matchId}] Failed to bootstrap live loop`,
        error?.message,
        error,
      );
    }
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
  const winner = terminal ? (victoryState?.winnerTeam ?? null) : null;

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

  const delayMs = Math.max(0, Number(victoryState?.meta?.finishDelayMs));
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
  room._resultPending = true;
  room.playerActivity?.finishMatch(room.matchId);
  console.log(
    `[GameRoom ${room.matchId}] Game finished. Winner: ${winnerTeam || "draw"}`,
  );

  room._loopRunning = false;
  room._scheduledActions.length = 0;
  console.log(
    "[bots:match-result]",
    JSON.stringify({
      matchId: room.matchId,
      winnerTeam,
      humans: [...room.players.values()]
        .filter((p) => !p.isBot)
        .map((p) => ({ team: p.team, trophies: Number(p.trophies) || 0 })),
      bots: [...room.botControllers.values()].map((c) => ({
        character: c.player.char_class,
        team: c.player.team,
        trophies: c.profile.trophies,
        ...c.metrics,
      })),
      timing: room._botTickStats || null,
    }),
  );
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

  let rewardSummary = [];
  let rewardsPending = false;
  try {
    rewardSummary = room.matchResults
      ? await room.matchResults.complete(room, winnerTeam)
      : await room._distributeMatchRewards(winnerTeam);
    room._resultPending = false;
  } catch (error) {
    rewardsPending = true;
    console.error(`[GameRoom ${room.matchId}] result settlement pending`, error?.message);
  }
  const finalMeta = { ...(meta || {}), rewards: rewardSummary, rewardsPending };

  room.io.to(`game:${room.matchId}`).emit("game:over", {
    matchId: room.matchId,
    winnerTeam,
    meta: finalMeta,
  });

  try {
    await deleteMatchBots(room.db, room.matchId);
  } catch (error) {
    console.warn(
      `[GameRoom ${room.matchId}] bot cleanup failed`,
      error?.message || error,
    );
  }

  if (rewardsPending && room.matchResults) {
    const retry = async () => {
      try {
        await room.matchResults.complete(room, winnerTeam);
        room._resultPending = false;
        if (room.onFinished) room.onFinished(); else room.cleanup();
      } catch (error) {
        console.error(`[GameRoom ${room.matchId}] result retry pending`, error?.message);
        room._resultRetry = setTimeout(retry, 30000);
        room._resultRetry.unref?.();
      }
    };
    room._resultRetry = setTimeout(retry, 30000);
    room._resultRetry.unref?.();
    return;
  }

  setTimeout(() => {
    try {
      if (room.onFinished) room.onFinished();
      else room.cleanup();
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
