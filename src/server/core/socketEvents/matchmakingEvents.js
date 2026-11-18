const { resetPartyAfterQueue } = require('../../services/party/queueLeave');
const { getConfig } = require("../../config");
const { hasLegalAcceptance } = require("../../services/auth/legalAcceptance");
const { defineSocketHandler, checkPenalties } = require("./handler");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { inPartyOrder } = require("../../services/party/partyOperations");
const { isAdminUser } = require("../../services/auth/auth");
const {
  normalizeSelection,
  isSelectionQueueable,
  getSelectionBlockReason,
  selectionToLegacyMode,
} = require("../../services/match/gameSelectionCatalog");

function registerMatchmakingEvents(
  socket,
  { db, io, mm, abuseControl },
) {
  const { socketEvents: debugSocketEvents } = getConfig().diagnostics;
  socket.on(SOCKET_EVENTS.QUEUE_JOIN, async (data) => {
    try {
      const uname = socket.data.user?.name;
      const userId = socket.data.user?.user_id || null;
      if (!userId || !await hasLegalAcceptance(db, userId)) {
        socket.emit(SOCKET_EVENTS.MATCH_CANCELLED, { reason:'Please review the Terms before readying up.' });
        return;
      }
      const { mode, modeId, modeVariantId, selection, map, side, partyId } =
        data || {};
      const pid = uname ? await db.getPartyIdByName(uname) : null;
      if (partyId && Number(partyId) !== Number(pid)) throw new Error("Your party changed. Please refresh the lobby.");

      await inPartyOrder(db, pid || `user:${userId}`, async () => {
      if (abuseControl && userId) {
        const evaluateUserPenalty = async (targetUserId) => {
          const penalty = await checkPenalties(abuseControl, targetUserId);
          if (penalty?.type === "banned") {
            return { blocked: true, payload: { message: penalty.message } };
          }
          if (penalty?.type === "mm_suspended") {
            return { blocked: true, payload: {
              message: "Too many requests. Matchmaking is temporarily suspended.",
              suspendedUntilMs: penalty.suspendedUntilMs,
            } };
          }
          return { blocked: false };
        };

        const selfDecision = await evaluateUserPenalty(userId);
        if (selfDecision.blocked) {
          socket.emit(SOCKET_EVENTS.QUEUE_ERROR, selfDecision.payload);
          return;
        }

        if (pid) {
          const members = await db.fetchPartyMembersDetailed(pid);
          for (const member of members || []) {
            const memberUserId = Number(member?.user_id) || 0;
            if (!memberUserId) continue;
            const memberDecision = await evaluateUserPenalty(memberUserId);
            if (!memberDecision.blocked) continue;
            socket.emit(SOCKET_EVENTS.QUEUE_ERROR, {
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
      if (debugSocketEvents) console.log("[queue] queue:join request", {
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
      socket.emit(SOCKET_EVENTS.QUEUE_JOINED, {
        mode: legacyMode,
        modeId: normalizedSelection.modeId,
        modeVariantId: normalizedSelection.modeVariantId,
        selection: normalizedSelection,
        map: normalizedSelection.mapId,
        partyId: pid || null,
      });
      if (debugSocketEvents) console.log("[queue] queue:join success", {
        socketId: socket.id,
        username: uname || null,
        userId,
        partyId: pid || null,
        selection: normalizedSelection,
      });
      });
    } catch (e) {
      console.warn("queue:join error:", e?.message);
      socket.emit(SOCKET_EVENTS.QUEUE_ERROR, {
        message: e?.message || "queue join failed",
        code: e?.code, maintenanceUntil: e?.maintenanceUntil,
      });
    }
  });

  socket.on(SOCKET_EVENTS.QUEUE_LEAVE, defineSocketHandler(async (ack) => {
    try {
      const uname = socket.data.user?.name;
      const userId = socket.data.user?.user_id || null;
      const pid = uname ? await db.getPartyIdByName(uname) : null;
      await inPartyOrder(db, pid || `user:${userId}`, async () => {
      const result = await mm.queueLeave({
        partyId: pid || null,
        userId: pid ? null : userId,
      });
      if (result?.cancelled === false) {
        if (typeof ack === "function") ack({ ok: true, cancelled: false, matchId: result.matchId });
        return;
      }
      if (pid) await resetPartyAfterQueue(db, io, pid);

      if (pid) {
        io.to(`party:${pid}`).emit(SOCKET_EVENTS.MATCH_CANCELLED, {
          reason: `${uname} cancelled matchmaking`,
        });
      } else {
        socket.emit(SOCKET_EVENTS.MATCH_CANCELLED, {
          reason: "You cancelled matchmaking",
        });
      }
      if (typeof ack === 'function') ack({ ok: true, cancelled: true });
      });
    } catch (e) {
      if (typeof ack === 'function') ack({ ok: false });
      console.warn("queue:leave error:", e?.message);
    }
  }, { ackIndex: 0 }));

  socket.on(SOCKET_EVENTS.QUEUE_STATUS, defineSocketHandler(async (ack) => {
    if (typeof ack !== "function") return;
    try {
      const user = socket.data.user;
      if (!user?.user_id) return ack({ state: "missing" });
      const partyId = await db.getPartyIdByName(user.name);
      ack(await mm.queueStatus({ partyId, userId: user.user_id }));
    } catch (_) {
      ack({ state: "unavailable" });
    }
  }, { ackIndex: 0 }));

  socket.on(SOCKET_EVENTS.READY_ACK, async ({ matchId }) => {
    try {
      const userId = socket.data.user?.user_id;
      if (!userId || !matchId) return;
      await mm.handleReadyAck(userId, matchId);
    } catch (e) {
      console.warn("ready:ack error:", e?.message);
    }
  });

  socket.on(SOCKET_EVENTS.QUEUE_FILL_BOTS, async (payload = {}) => {
    try {
      const requester = socket.data.user;
      if (!requester?.name || !requester?.user_id) {
        throw new Error("Authentication required.");
      }
      // Traced debug clients (valid BB_NET_TRACE_TOKEN) may fill their own
      // party's queue with bots so test matches never wait for real players.
      if (!isAdminUser(requester) && !socket.data.netTrace) {
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
      socket.emit(SOCKET_EVENTS.QUEUE_FILL_BOTS_OK, { matchId: result.matchId });
    } catch (e) {
      socket.emit(SOCKET_EVENTS.QUEUE_FILL_BOTS_ERROR, {
        message: e?.message || "Unable to fill with bots.",
      });
    }
  });
}

module.exports = { registerMatchmakingEvents };
