const { defineSocketHandler, checkPenalties } = require("./handler");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { isCompatibleClient } = require("./clientCompatibility");
const { loadMatchData } = require('../../services/match/matchRosterService');
function registerGameEvents(socket, { db, gameHub, abuseControl }) {
  socket.on(SOCKET_EVENTS.GAME_JOIN, defineSocketHandler(async (data, cb, user) => {
    const matchId = Number(data?.matchId);
    if (!Number.isFinite(matchId) || matchId <= 0) {
      cb?.({ ok: false, error: "bad_matchId" });
      socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: "Match ID required", code: "BAD_MATCH_ID" });
      console.warn("[game:join] bad matchId", { sid: socket.id });
      return;
    }

    const penalty = await checkPenalties(abuseControl, user.user_id);
    if (penalty?.type === "banned") {
      cb?.({ ok: false, error: "banned" });
      socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: penalty.message, code: "BANNED" });
      return;
    }
    if (penalty?.type === "mm_suspended") {
      cb?.({ ok: false, error: "mm_suspended" });
      socket.emit(SOCKET_EVENTS.GAME_ERROR, {
        message: "Matchmaking suspension is active. You cannot join matches right now.",
        suspendedUntilMs: penalty.suspendedUntilMs,
        code: "MM_SUSPENDED",
      });
      return;
    }

    try {
      const room0 = gameHub.getGameRoom(matchId);
      if (!room0) {
        const matchData = await loadMatchData(db, matchId, { liveOnly: true });
        if (matchData?.players.length) await gameHub.createGameRoom(matchId, matchData);
      }
    } catch (e) {
      console.warn("[socket] ensure room failed:", e?.message);
    }

    const room = gameHub.getGameRoom(matchId);
    if (!isCompatibleClient(room, data)) {
      cb?.({ ok: false, error: 'client_update_required' });
      socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: 'Please reload the game to join this match.', code: 'CLIENT_UPDATE_REQUIRED' });
      return;
    }
    const ok = await gameHub.handlePlayerJoin(socket, matchId);
    if (ok) {
      cb?.({ ok: true, matchId });
      socket.emit(SOCKET_EVENTS.GAME_JOINED, { ok: true, matchId });
      socket.data.gameMatchId = matchId;
    } else {
      cb?.({ ok: false, error: "join_failed" });
      socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: "Failed to join game", code: "JOIN_FAILED" });
      console.warn("[game:join] hub returned false", {
        sid: socket.id,
        user: user.name,
        matchId,
      });
    }
  }, {
    auth: () => socket.data.user,
    onUnauthorized: ack => {
      ack?.({ ok: false, error: "unauthorized" });
      socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: "Unauthorized", code: "UNAUTHORIZED" });
      console.warn("[game:join] unauthorized socket", { sid: socket.id });
    },
    onError: (error, ack) => {
      ack?.({ ok: false, error: "exception" });
      socket.emit(SOCKET_EVENTS.GAME_ERROR, { message: "Failed to join game", code: "JOIN_FAILED" });
      console.warn("[game:join] error", error?.message);
    },
  }));
}

module.exports = { registerGameEvents };
