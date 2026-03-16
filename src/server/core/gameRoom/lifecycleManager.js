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

  room.io.to(`game:${room.matchId}`).emit("game:start", {
    countdown: 3,
  });

  setTimeout(() => {
    room.startGameLoop();
  }, 3000);
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
  const aliveByTeam = { team1: 0, team2: 0 };
  for (const p of room.players.values()) {
    if (!p.isAlive) continue;
    if (p.team === "team1") aliveByTeam.team1++;
    else if (p.team === "team2") aliveByTeam.team2++;
  }

  const t1Alive = aliveByTeam.team1;
  const t2Alive = aliveByTeam.team2;
  let winner = null;
  if (t1Alive === 0 && t2Alive === 0) {
    winner = null;
  } else if (t1Alive === 0) {
    winner = "team2";
  } else if (t2Alive === 0) {
    winner = "team1";
  }

  if (winner !== null || (t1Alive === 0 && t2Alive === 0)) {
    room._finishGame(winner, { t1Alive, t2Alive });
  }
}

async function finishGame(room, winnerTeam, meta = {}) {
  if (room.status === "finished") return;
  room.status = "finished";
  console.log(
    `[GameRoom ${room.matchId}] Game finished. Winner: ${winnerTeam || "draw"}`,
  );

  room._loopRunning = false;
  if (room.gameLoop) {
    try {
      clearInterval(room.gameLoop);
    } catch (_) {}
    room.gameLoop = null;
  }

  try {
    await room.db.runQuery(
      "UPDATE matches SET status = 'completed' WHERE match_id = ?",
      [room.matchId],
    );
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
