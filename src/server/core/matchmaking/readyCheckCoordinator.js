function createReadyCheckCoordinator({
  db,
  io,
  partyStatus,
  cancelMatch,
  getMatchDataForGameRoom,
  gameHub,
}) {
  const readyStates = new Map();

  function startReadyCheck(matchId, userIds) {
    const deadline = Date.now() + 10_000;
    const state = {
      userIds: new Set(userIds),
      ready: new Set(),
      deadline,
      timer: null,
    };

    const check = async () => {
      if (Date.now() >= state.deadline) {
        clearInterval(state.timer);
        readyStates.delete(matchId);
        if (state.ready.size !== state.userIds.size) {
          await cancelMatch(
            matchId,
            "One or more players disconnected or timed out",
          );
          console.log(
            `[ready:timeout] #${matchId} ready=${state.ready.size}/${state.userIds.size}`,
          );
        }
        return;
      }

      if (state.ready.size !== state.userIds.size) return;

      clearInterval(state.timer);
      readyStates.delete(matchId);
      await db.runQuery("UPDATE matches SET status='live' WHERE match_id= ?", [
        matchId,
      ]);

      try {
        const rows = await db.runQuery(
          "SELECT DISTINCT party_id FROM match_participants WHERE match_id = ? AND party_id IS NOT NULL",
          [matchId],
        );
        const ids = rows.map((r) => r.party_id);
        if (ids.length) await db.setPartiesStatus(ids, partyStatus.LIVE);
      } catch (_) {}

      console.log(`[match:live] #${matchId}`);

      try {
        const placeholders = userIds.map(() => "?").join(",");
        if (userIds.length) {
          const r = await db.runQuery(
            `DELETE FROM match_tickets WHERE user_id IN (${placeholders}) OR party_id IN (SELECT DISTINCT party_id FROM match_participants WHERE match_id=?)`,
            [...userIds, matchId],
          );
          if (r?.affectedRows) {
            console.log(`[match:live] cleaned stray tickets=${r.affectedRows}`);
          }
        }
      } catch (_) {}

      if (!gameHub) return;

      try {
        const matchData = await getMatchDataForGameRoom(matchId);
        await gameHub.createGameRoom(matchId, matchData);

        const liveUserIds = Array.from(state.userIds);
        const placeholders = liveUserIds.map(() => "?").join(",");
        const socketRows = await db.runQuery(
          `SELECT user_id, socket_id FROM users WHERE user_id IN (${placeholders})`,
          liveUserIds,
        );

        for (const row of socketRows) {
          if (!row.socket_id) continue;
          const socket = io.sockets.sockets.get(row.socket_id);
          if (socket) {
            socket.emit("match:gameReady", { matchId });
          }
        }
      } catch (error) {
        console.error(
          `[match:live] Failed to create game room for match ${matchId}:`,
          error,
        );
      }
    };

    state.timer = setInterval(check, 250);
    readyStates.set(matchId, state);
  }

  function handleReadyAck(userId, matchId) {
    const st = readyStates.get(Number(matchId));
    if (!st) return;
    if (st.userIds.has(Number(userId))) st.ready.add(Number(userId));
  }

  return {
    startReadyCheck,
    handleReadyAck,
  };
}

module.exports = { createReadyCheckCoordinator };
