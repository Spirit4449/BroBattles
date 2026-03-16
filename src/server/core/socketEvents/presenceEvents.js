function registerPresenceEvents(
  socket,
  {
    db,
    io,
    mm,
    gameHub,
    setPresence,
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

    try {
      const pid = await db.getPartyIdByName(uname);
      const liveMatches = await db.runQuery(
        `SELECT m.match_id FROM matches m
         JOIN match_participants mp ON m.match_id = mp.match_id
         JOIN users u ON u.user_id = mp.user_id
         WHERE u.name = ? AND m.status = 'live'`,
        [uname],
      );

      if (liveMatches.length > 0) {
        console.log(
          `[transition] user=${uname} moving to live game, not canceling`,
        );
        return;
      }

      await mm.handleDisconnect(uname);
      if (pid) {
        io.to(`party:${pid}`).emit("match:cancelled", {
          reason: `${uname} disconnected or went offline`,
        });
        console.log(`[cancel][emit] bye user=${uname} party=${pid}`);
      } else {
        socket.emit("match:cancelled", {
          reason: `${uname} disconnected or went offline`,
        });
        console.log(`[cancel][emit] bye-solo user=${uname}`);
      }
    } catch (_) {}
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

    try {
      const liveMatches = await db.runQuery(
        `SELECT m.match_id FROM matches m
         JOIN match_participants mp ON m.match_id = mp.match_id
         JOIN users u ON u.user_id = mp.user_id
         WHERE u.name = ? AND m.status = 'live'`,
        [username],
      );

      if (liveMatches.length === 0) {
        await mm.handleDisconnect(username);
        const pid = await db.getPartyIdByName(username);
        if (pid) {
          io.to(`party:${pid}`).emit("match:cancelled");
          console.log(
            `[cancel][emit] disconnect user=${username} party=${pid}`,
          );
        } else {
          console.log(`[cancel] disconnect user=${username} solo`);
        }
      }
    } catch (_) {}
  });
}

module.exports = { registerPresenceEvents };
