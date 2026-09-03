const { loadMatchData } = require('../../services/matchRosterService');
function registerGameEvents(socket, { db, gameHub, abuseControl }) {
  socket.on("game:join", async (data, cb) => {
    try {
      const user = socket.data.user;
      const matchId = Number(data?.matchId);
      console.log("User attempting to join game:");

      if (!user) {
        cb?.({ ok: false, error: "unauthorized" });
        socket.emit("game:error", { message: "Unauthorized" });
        console.warn("[game:join] unauthorized socket", { sid: socket.id });
        return;
      }
      if (!Number.isFinite(matchId) || matchId <= 0) {
        cb?.({ ok: false, error: "bad_matchId" });
        socket.emit("game:error", { message: "Match ID required" });
        console.warn("[game:join] bad matchId", { sid: socket.id, data });
        return;
      }

      if (abuseControl && Number(user?.user_id) > 0) {
        const penalties = await abuseControl.getActivePenaltyState(
          Number(user.user_id),
        );
        const mmSuspendedUntilMs = Number(penalties?.mmSuspendedUntilMs || 0);
        if (penalties?.isBanned) {
          cb?.({ ok: false, error: "banned" });
          socket.emit("game:error", {
            message: penalties?.banReason || "Your account has been banned.",
          });
          return;
        }
        if (mmSuspendedUntilMs && mmSuspendedUntilMs > Date.now()) {
          cb?.({ ok: false, error: "mm_suspended" });
          socket.emit("game:error", {
            message:
              "Matchmaking suspension is active. You cannot join matches right now.",
            suspendedUntilMs: mmSuspendedUntilMs,
          });
          return;
        }
      }

      try {
        const room0 = gameHub.getGameRoom(matchId);
        if (!room0) {
          const rows = await db.runQuery(
            "SELECT * FROM matches WHERE match_id = ? LIMIT 1",
            [matchId],
          );
          if (rows?.length && String(rows[0].status).toLowerCase() === "live") {
            const matchData = await loadMatchData(db, matchId);
            if (matchData.players.length) await gameHub.createGameRoom(matchId, matchData);
          }
        }
      } catch (e) {
        console.warn("[socket] ensure room failed:", e?.message);
      }

      const ok = await gameHub.handlePlayerJoin(socket, matchId);
      if (ok) {
        cb?.({ ok: true, matchId });
        socket.emit("game:joined", { ok: true, matchId });
        socket.data.gameMatchId = matchId;
        console.log("[game:join] ok", {
          sid: socket.id,
          user: user.name,
          matchId,
        });
      } else {
        cb?.({ ok: false, error: "join_failed" });
        socket.emit("game:error", { message: "Failed to join game" });
        console.warn("[game:join] hub returned false", {
          sid: socket.id,
          user: user.name,
          matchId,
        });
      }
    } catch (e) {
      cb?.({ ok: false, error: "exception" });
      socket.emit("game:error", { message: "Failed to join game" });
      console.warn("[game:join] error", e?.message);
    }
  });

  socket.on("game:input", () => {
    // Forwarded/handled in gameRoom.js via setupPlayerSocket.
  });

  socket.on("game:action", () => {
    // Forwarded/handled in gameRoom.js.
  });
}

module.exports = { registerGameEvents };
