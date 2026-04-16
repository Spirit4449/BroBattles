function registerPresenceEvents(
  socket,
  {
    db,
    io,
    mm,
    gameHub,
    setPresence,
    partyQueueTransition,
    userSockets,
    pendingOffline,
    DISCONNECT_GRACE_MS,
  },
) {
  socket.on("heartbeat", async (partyId) => {
    const uname = socket.data.user?.name;
    if (!uname || !partyId) return;
    try {
      await db.updateLastSeen(partyId, uname);
      const rows = await db.runQuery(
        "SELECT status FROM users WHERE name = ? LIMIT 1",
        [uname],
      );
      const currentStatus = String(rows?.[0]?.status || "online").toLowerCase();
      if (currentStatus === "offline") {
        await setPresence(uname, "online", partyId);
      }
    } catch (e) {
      console.warn("heartbeat error:", e?.message);
    }
  });

  socket.on("client:bye", async () => {
    try {
      const mid = socket.data.gameMatchId;
      if (mid) {
        await gameHub.handlePlayerLeave(socket, mid);
        socket.data.gameMatchId = null;
      }
    } catch (_) {}

    const uname = socket.data.user?.name;
    if (!uname) return;

    const t = pendingOffline.get(uname);
    if (t) {
      clearTimeout(t);
      pendingOffline.delete(uname);
    }
    const set = userSockets.get(uname);
    if (set) set.delete(socket.id);
    if (!set || set.size === 0) {
      const timer = setTimeout(async () => {
        const s = userSockets.get(uname);
        if (!s || s.size === 0) await setPresence(uname, "offline");
        pendingOffline.delete(uname);
      }, DISCONNECT_GRACE_MS);
      pendingOffline.set(uname, timer);
    }

    await partyQueueTransition.cancelForDisconnectedUser({
      username: uname,
      socket,
      reason: `${uname} disconnected or went offline`,
      allowSoloEmit: true,
    });
  });

  socket.on("disconnect", async () => {
    const userId = socket.data.user?.user_id;
    const username = socket.data.user?.name;

    try {
      if (userId) await db.clearUserSocketIfMatch(userId, socket.id);
    } catch (_) {}

    if (!username) return;

    try {
      const mid = socket.data.gameMatchId;
      if (mid) {
        await gameHub.handlePlayerLeave(socket, mid);
        socket.data.gameMatchId = null;
      }
    } catch (e) {
      console.warn("leave game on disconnect failed:", e?.message);
    }

    try {
      const liveMatches = await db.runQuery(
        `SELECT m.match_id FROM matches m
         JOIN match_participants mp ON m.match_id = mp.match_id
         JOIN users u ON u.user_id = mp.user_id
         WHERE u.name = ? AND m.status = 'live'`,
        [username],
      );

      if (liveMatches.length > 0) {
        console.log(
          `[disconnect] user=${username} has live match, not cleaning up game rooms yet`,
        );
      }
    } catch (e) {
      console.warn("game disconnect cleanup error:", e?.message);
    }

    const set = userSockets.get(username);
    if (set) set.delete(socket.id);
    const hasAny = !!(set && set.size > 0);
    if (!hasAny) {
      const timer = setTimeout(async () => {
        const s = userSockets.get(username);
        if (!s || s.size === 0) await setPresence(username, "offline");
        pendingOffline.delete(username);
      }, DISCONNECT_GRACE_MS);
      pendingOffline.set(username, timer);
    }

    await partyQueueTransition.cancelForDisconnectedUser({
      username,
      socket: null,
      reason: null,
      allowSoloEmit: false,
    });
  });
}

module.exports = { registerPresenceEvents };
