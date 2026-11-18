const lifecycleManager = require("./lifecycleManager");
const matchLifecycle = require("../../services/match/matchLifecycleService");

function cancelAbandonTimer(room, reason = "clear") {
  if (!room._abandonTimer) return;
  clearTimeout(room._abandonTimer);
  room._abandonTimer = null;
  if (!room._netTestEnabled) {
    console.log(
      `[GameRoom ${room.matchId}] abandon timer cleared (${reason})`,
    );
  }
}

function scheduleAbandonIfNoHumansConnected(room) {
  if (room.status === "finished") return;
  if (room.hasConnectedHumanPlayers()) {
    room._cancelAbandonTimer("humans_still_connected");
    return;
  }
  if (room._abandonTimer) return;

  if (!room._netTestEnabled) {
    console.warn(
      `[GameRoom ${room.matchId}] no connected humans; scheduling abandonment in ${room.ABANDON_MATCH_GRACE_MS}ms`,
    );
  }

  room._abandonTimer = setTimeout(() => {
    room._abandonTimer = null;
    if (room.status === "finished") return;
    if (room.hasConnectedHumanPlayers()) return;
    void room.cancelMatchAsAbandoned("All players left the match").catch(error => console.error("[match] abandonment failed", room.matchId, error));
  }, room.ABANDON_MATCH_GRACE_MS);
}

async function cancelMatchAsAbandoned(room, reason) {
  if (room.status === "finished") return;
  room.status = "finished";
  room.playerActivity?.finishMatch(room.matchId, { endScreen: false });
  room._loopRunning = false;
  lifecycleManager.clearPendingVictory(room);
  lifecycleManager.clearStartTimers(room);

  try {
    await matchLifecycle.cancelMatch(room.db, room.io, room.matchId, { reason, notify: 'party', liveOnly: true });
  } finally {
    if (room.onFinished) room.onFinished();
    else room.cleanup();
  }
}

module.exports = { cancelAbandonTimer, scheduleAbandonIfNoHumansConnected, cancelMatchAsAbandoned };
