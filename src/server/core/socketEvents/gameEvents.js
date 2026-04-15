function registerGameEvents(socket, { db, gameHub }) {
  const {
    normalizeSelectionFromRow,
  } = require("../../helpers/gameSelectionCatalog");

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

      try {
        const room0 = gameHub.getGameRoom(matchId);
        if (!room0) {
          const rows = await db.runQuery(
            "SELECT * FROM matches WHERE match_id = ? LIMIT 1",
            [matchId],
          );
          if (rows?.length && String(rows[0].status).toLowerCase() === "live") {
            const partRows = await db.runQuery(
              `SELECT mp.user_id, mp.party_id, mp.team, mp.char_class, u.name, u.selected_profile_icon_id AS profile_icon_id
                 FROM match_participants mp
                 JOIN users u ON u.user_id = mp.user_id
                WHERE mp.match_id = ?`,
              [matchId],
            );
            if (partRows?.length) {
              const selection = normalizeSelectionFromRow(rows[0] || {});
              const matchData = {
                mode: rows[0].mode,
                modeId: selection.modeId,
                modeVariantId: selection.modeVariantId,
                map: selection.mapId,
                players: partRows.map((p) => ({
                  user_id: p.user_id,
                  name: p.name,
                  party_id: p.party_id,
                  team: p.team,
                  char_class: p.char_class,
                  profile_icon_id: String(p.profile_icon_id || "") || null,
                })),
              };
              await gameHub.createGameRoom(matchId, matchData);
            }
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
