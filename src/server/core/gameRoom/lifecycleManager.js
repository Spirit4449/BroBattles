const { appendPartyChatLog } = require("../../services/partyChatLog");
const { deleteMatchBots } = require("../../services/matchRosterService");
const { ALL_DEAD_GAME_OVER_DELAY_MS } = require("../gameRoomConfig");
const effectManager = require("./effects/effectManager");
const {
  COUNTDOWN_MS,
  START_DEADLINE_MS,
  plannedCountdownStart,
} = require("../../../shared/matchIntroTiming");

// Every pre-fight timer lives here so cleanup and cancellation release them all.
function clearStartTimers(room) {
  clearTimeout(room._startTimer);
  clearTimeout(room._startDeadlineTimer);
  clearTimeout(room._countdownTimeout);
  room._startTimer = null;
  room._startDeadlineTimer = null;
  room._countdownTimeout = null;
}

function armStartDeadline(room) {
  room._startDeadlineTimer = setTimeout(() => {
    room._startDeadlineTimer = null;
    room.potentialStartGame({ force: true });
  }, START_DEADLINE_MS);
  room._startDeadlineTimer.unref?.();
}

/**
 * A human's loading screen lifted and their pregame began. Returns true the
 * first time each user reports ready before the countdown.
 */
function noteReady(room, player, now = Date.now()) {
  if (room.status !== "waiting" || room._readyAt.has(player.user_id)) return false;
  room._readyAt.set(player.user_id, now);
  room.potentialStartGame();
  return true;
}

// Reschedule the countdown from the ready signals received so far. Every
// reschedule moves it earlier (everyone loaded) or keeps it, never later.
function potentialStartGame(room, { force = false } = {}) {
  if (room.status !== "waiting" || room._disposed) return;
  if (force) {
    if (!room.hasConnectedHumanPlayers()) {
      void room._cancelMatchAsAbandoned("No players loaded into the match");
      return;
    }
    startGame(room, "deadline");
    return;
  }
  const startAt = plannedCountdownStart(
    [...room._readyAt.values()],
    room._requiredUserIds.size,
  );
  if (startAt == null) return;
  clearTimeout(room._startTimer);
  room._startTimer = setTimeout(() => {
    room._startTimer = null;
    const allIn = room._readyAt.size >= room._requiredUserIds.size;
    startGame(room, allIn ? "all_ready" : "grace_expired");
  }, Math.max(0, startAt - Date.now()));
}

function startGame(room, reason = "all_ready") {
  if (room.status !== "waiting" || room._disposed) return;
  clearStartTimers(room);
  console.log(
    `[GameRoom ${room.matchId}] Starting countdown (reason=${reason}) ready=${room._readyAt.size}/${room._requiredUserIds.size} connected=${room.getPlayerCount()}`,
  );

  room.status = "active";
  room.initializeSpawnPositions();
  room._countdownEndsAt = Date.now() + COUNTDOWN_MS;
  for (const p of room.players.values()) p._controlLockUntil = room._countdownEndsAt;
  try {
    room.gameMode?.onStart?.();
  } catch (e) {
    console.warn(`[GameRoom ${room.matchId}] mode onStart failed`, e?.message);
  }

  room.io.to(`game:${room.matchId}`).emit("game:start", {
    countdownMs: COUNTDOWN_MS,
    spawns: Object.fromEntries(Array.from(room.players.values(), p => [p.name, { x: p.x, y: p.y }])),
  });

  room._countdownTimeout = setTimeout(() => {
    if (room._disposed || room.status !== "active") return;
    room._countdownTimeout = null;
    room._countdownEndsAt = 0;
    try {
      const now = Date.now();
      console.log(
        `[GameRoom ${room.matchId}] Countdown finished, bootstrapping live loop`,
        {
          players: room.players.size,
          connectedPlayers: room.getPlayerCount(),
          ready: room._readyAt.size,
          required: room._requiredUserIds.size,
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
  }, COUNTDOWN_MS);
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
  // One line per match: which correction path fired for each human, if any.
  const movement = [...room.players.values()]
    .filter((p) => !p.isBot && p._movementStats)
    .map((p) => ({ name: p.name, ...p._movementStats,
      maxErrorPx: Math.round(p._movementStats.maxErrorPx * 10) / 10 }));
  if (movement.length) {
    console.log("[movement:corrections]", JSON.stringify({ matchId: room.matchId, players: movement }));
  }
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

  try {
    const participants = await room.db.runQuery(
      "SELECT mp.party_id, mp.team, u.name FROM match_participants mp JOIN users u ON u.user_id = mp.user_id WHERE mp.match_id = ? AND mp.party_id IS NOT NULL",
      [room.matchId],
    );
    for (const partyId of new Set((participants || []).map(player => Number(player.party_id)))) {
      appendPartyChatLog(room.io, partyId, {
        kind: "battle", key: `battle:${room.matchId}`,
        body: "Battle ended",
        winnerTeam,
        participants: (participants || []).filter(player => Number(player.party_id) === partyId).map(({ name, team }) => ({ name, team })),
      });
    }
  } catch (error) {
    console.warn("[chat] battle log failed", error?.message);
  }


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
  clearStartTimers,
  armStartDeadline,
  noteReady,
  potentialStartGame,
  startGame,
  broadcastParticipantStatus,
  checkVictoryCondition,
  finishGame,
};
