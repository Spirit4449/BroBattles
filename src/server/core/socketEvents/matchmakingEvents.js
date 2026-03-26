const {
  normalizeSelection,
  isSelectionQueueable,
  getSelectionBlockReason,
  selectionToLegacyMode,
} = require("../../helpers/gameSelectionCatalog");

function registerMatchmakingEvents(socket, { db, io, mm, PARTY_STATUS }) {
  async function setPartyStatusSafe(partyId, status) {
    if (!partyId) return;
    if (typeof db.setPartyStatus === "function") {
      await db.setPartyStatus(partyId, status);
      return;
    }
    await db.runQuery("UPDATE parties SET status = ? WHERE party_id = ?", [
      status,
      partyId,
    ]);
  }

  socket.on("queue:join", async (data) => {
    try {
      const uname = socket.data.user?.name;
      const userId = socket.data.user?.user_id || null;
      const { mode, modeId, modeVariantId, selection, map, side, partyId } =
        data || {};
      const normalizedSelection = normalizeSelection({
        modeId: selection?.modeId || modeId || null,
        modeVariantId: selection?.modeVariantId || modeVariantId || null,
        legacyMode: mode,
        mapId: selection?.mapId ?? map,
      });
      if (!isSelectionQueueable(normalizedSelection)) {
        throw new Error(getSelectionBlockReason(normalizedSelection));
      }
      const legacyMode = selectionToLegacyMode(
        normalizedSelection.modeId,
        normalizedSelection.modeVariantId,
      );
      const pid = partyId || (uname ? await db.getPartyIdByName(uname) : null);
      await mm.queueJoin({
        partyId: pid || null,
        userId: pid ? null : userId,
        mode: legacyMode,
        modeId: normalizedSelection.modeId,
        modeVariantId: normalizedSelection.modeVariantId,
        map: normalizedSelection.mapId,
        side,
      });
      socket.emit("queue:joined", {
        mode: legacyMode,
        modeId: normalizedSelection.modeId,
        modeVariantId: normalizedSelection.modeVariantId,
        selection: normalizedSelection,
        map: normalizedSelection.mapId,
        partyId: pid || null,
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
          await setPartyStatusSafe(pid, PARTY_STATUS.IDLE);
        } catch (_) {}
        try {
          const members = await db.fetchPartyMembersDetailed(pid);
          for (const m of members || []) {
            if (!m?.name) continue;
            try {
              await db.setUserStatus(m.name, "online");
            } catch (_) {}
            io.to(`party:${pid}`).emit("status:update", {
              partyId: pid,
              name: m.name,
              status: "online",
            });
          }
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
