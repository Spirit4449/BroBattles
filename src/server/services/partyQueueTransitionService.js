const { inPartyOrder } = require("../helpers/partyOperations");

function createPartyQueueTransitionService({ db, io, mm }) {
  async function resetPartyMembersOnline(partyId, { excludeName = null } = {}) {
    if (!partyId) return;
    try {
      const members = await db.fetchPartyMembersDetailed(partyId);
      for (const m of members || []) {
        if (!m?.name) continue;
        if (excludeName && m.name === excludeName) continue;
        try {
          await db.setUserStatus(m.name, "online");
        } catch (_) {}
        io.to(`party:${partyId}`).emit("status:update", {
          partyId,
          name: m.name,
          status: "online",
        });
      }
    } catch (_) {}
  }

  async function userHasLiveMatch(username) {
    const liveMatches = await db.runQuery(
      `SELECT m.match_id FROM matches m
       JOIN match_participants mp ON m.match_id = mp.match_id
       JOIN users u ON u.user_id = mp.user_id
       WHERE u.name = ? AND m.status = 'live'`,
      [username],
    );
    return liveMatches.length > 0;
  }

  async function cancelPartyQueue({ partyId, userId = null, reason }) {
    try {
      if (partyId) {
        try {
          await mm.queueLeave({ partyId, userId: null });
        } catch (_) {}
        await db.runQuery(
          "UPDATE parties SET status = 'idle' WHERE party_id = ? AND status IN ('queued', 'ready_check')",
          [partyId],
        );
        await resetPartyMembersOnline(partyId);
        io.to(`party:${partyId}`).emit("match:cancelled", { reason });
        console.log(
          `[cancel][party] cancelled party ${partyId}${reason ? ` reason=${reason}` : ""}`,
        );
      }
      if (userId) {
        try {
          await mm.queueLeave({ partyId: null, userId });
        } catch (_) {}
      }
    } catch (e) {
      console.warn("cancelPartyQueue failed:", e?.message);
    }
  }

  async function cancelForDisconnectedUser({
    username,
    socket = null,
    reason,
    allowSoloEmit = false,
  }) {
    try {
      if (await userHasLiveMatch(username)) {
        console.log(
          `[transition] user=${username} moving to live game, not canceling`,
        );
        return;
      }

      const pid = await db.getPartyIdByName(username);
      await inPartyOrder(db, pid || username, async () => {
        const partyRows = pid ? await db.runQuery(
          "SELECT status FROM parties WHERE party_id = ? LIMIT 1", [pid],
        ) : [];
        const wasQueued = ["queued", "ready_check"].includes(partyRows[0]?.status);
        await mm.handleDisconnect(username);
        if (pid && !wasQueued) {
          await db.setUserStatus(username, "offline");
          io.to(`party:${pid}`).emit("status:update", { partyId: pid, name: username, status: "offline" });
          return;
        }
        if (pid) {
          await db.runQuery(
            "UPDATE parties SET status = 'idle' WHERE party_id = ? AND status IN ('queued', 'ready_check')", [pid],
          );
          await db.setUserStatus(username, "offline");
          io.to(`party:${pid}`).emit("status:update", { partyId: pid, name: username, status: "offline" });
          await resetPartyMembersOnline(pid, { excludeName: username });
          const payload = reason ? { reason } : {};
          io.to(`party:${pid}`).emit("match:cancelled", payload);
          console.log(`[cancel][emit] user=${username} party=${pid}`);
        } else if (allowSoloEmit && socket) {
          const payload = reason ? { reason } : {};
          socket.emit("match:cancelled", payload);
          console.log(`[cancel][emit] solo user=${username}`);
        }
      });
    } catch (_) {}
  }

  return {
    userHasLiveMatch,
    cancelPartyQueue,
    cancelForDisconnectedUser,
  };
}

module.exports = { createPartyQueueTransitionService };
