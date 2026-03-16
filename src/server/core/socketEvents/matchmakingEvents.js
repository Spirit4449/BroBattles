function registerMatchmakingEvents(socket, { db, io, mm, PARTY_STATUS }) {
  socket.on("queue:join", async (data) => {
    try {
      const uname = socket.data.user?.name;
      const userId = socket.data.user?.user_id || null;
      const { mode, map, side, partyId } = data || {};
      const pid = partyId || (uname ? await db.getPartyIdByName(uname) : null);
      await mm.queueJoin({
        partyId: pid || null,
        userId: pid ? null : userId,
        mode,
        map,
        side,
      });
    } catch (e) {
      console.warn("queue:join error:", e?.message);
      socket.emit("queue:error", {
        message: e?.message || "queue join failed",
      });
    }
  });

  socket.on("queue:leave", async () => {
    try {
      const uname = socket.data.user?.name;
      const userId = socket.data.user?.user_id || null;
      const pid = uname ? await db.getPartyIdByName(uname) : null;
      await mm.queueLeave({
        partyId: pid || null,
        userId: pid ? null : userId,
      });
      if (pid) {
        try {
          await db.setPartyStatus(pid, PARTY_STATUS.IDLE);
        } catch (_) {}
      }

      if (pid) {
        io.to(`party:${pid}`).emit("match:cancelled", {
          reason: `${uname} cancelled matchmaking`,
        });
      } else {
        socket.emit("match:cancelled", {
          reason: "You cancelled matchmaking",
        });
      }
    } catch (e) {
      console.warn("queue:leave error:", e?.message);
    }
  });

  socket.on("ready:ack", async ({ matchId }) => {
    try {
      const userId = socket.data.user?.user_id;
      if (!userId || !matchId) return;
      await mm.handleReadyAck(userId, matchId);
    } catch (e) {
      console.warn("ready:ack error:", e?.message);
    }
  });
}

module.exports = { registerMatchmakingEvents };
