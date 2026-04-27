const {
  normalizeSelection,
  isSelectionQueueable,
  getSelectionBlockReason,
  selectionToLegacyMode,
} = require("../../helpers/gameSelectionCatalog");

function registerMatchmakingEvents(
  socket,
  { db, io, mm, PARTY_STATUS, abuseControl },
) {
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
      const pid = partyId || (uname ? await db.getPartyIdByName(uname) : null);

      if (abuseControl && userId) {
        const evaluateUserPenalty = async (targetUserId) => {
          const penalties =
            await abuseControl.getActivePenaltyState(targetUserId);
          const mmSuspendedUntilMs = Number(penalties?.mmSuspendedUntilMs || 0);
          if (penalties?.isBanned) {
            return {
              blocked: true,
              payload: {
                message:
                  penalties?.banReason || "Your account has been banned.",
              },
            };
          }
          if (mmSuspendedUntilMs && mmSuspendedUntilMs > Date.now()) {
            return {
              blocked: true,
              payload: {
                message:
                  "Too many requests. Matchmaking is temporarily suspended.",
                suspendedUntilMs: mmSuspendedUntilMs,
              },
            };
          }
          return { blocked: false };
        };

        const selfDecision = await evaluateUserPenalty(userId);
        if (selfDecision.blocked) {
          socket.emit("queue:error", selfDecision.payload);
          return;
        }

        if (pid) {
          const members = await db.fetchPartyMembersDetailed(pid);
          for (const member of members || []) {
            const memberUserId = Number(member?.user_id) || 0;
            if (!memberUserId) continue;
            const memberDecision = await evaluateUserPenalty(memberUserId);
            if (!memberDecision.blocked) continue;
            socket.emit("queue:error", {
              ...memberDecision.payload,
              message: `${member?.name || "A party member"} is currently suspended from matchmaking.`,
            });
            return;
          }
        }
      }

      const normalizedSelection = normalizeSelection({
        modeId: selection?.modeId || modeId || null,
        modeVariantId: selection?.modeVariantId || modeVariantId || null,
        legacyMode: mode,
        mapId: selection?.mapId ?? map,
      });
      console.log("[queue] queue:join request", {
        socketId: socket.id,
        username: uname || null,
        userId,
        providedPartyId: partyId || null,
        resolvedSelection: normalizedSelection,
        side: side || null,
      });
      if (!isSelectionQueueable(normalizedSelection)) {
        throw new Error(getSelectionBlockReason(normalizedSelection));
      }
      const legacyMode = selectionToLegacyMode(
        normalizedSelection.modeId,
        normalizedSelection.modeVariantId,
      );
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
      console.log("[queue] queue:join success", {
        socketId: socket.id,
        username: uname || null,
        userId,
        partyId: pid || null,
        selection: normalizedSelection,
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

  socket.on("queue:fill-bots", async (payload = {}) => {
    try {
      const requester = socket.data.user;
      if (!requester?.name || !requester?.user_id) {
        throw new Error("Authentication required.");
      }
      const adminNames = String(process.env.ADMIN_USERS || "nishay")
        .split(",")
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);
      if (!adminNames.includes(String(requester.name).toLowerCase())) {
        throw new Error("Admins only.");
      }
      const partyId = await db.getPartyIdByName(requester.name);
      const requestedBotHealth = Number(payload?.botHealthOverride);
      const botHealthOverride =
        payload?.mode === "unlimited-health" &&
        Number.isFinite(requestedBotHealth) &&
        requestedBotHealth > 0
          ? Math.round(requestedBotHealth)
          : null;
      const result = await mm.createBotFilledMatch({
        userId: requester.user_id,
        partyId: partyId || null,
        botHealthOverride,
      });
      socket.emit("queue:fill-bots:ok", { matchId: result.matchId });
    } catch (e) {
      socket.emit("queue:fill-bots:error", {
        message: e?.message || "Unable to fill with bots.",
      });
    }
  });
}

module.exports = { registerMatchmakingEvents };
