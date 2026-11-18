const { hasLegalAcceptance } = require('../auth/legalAcceptance');
const { SOCKET_EVENTS } = require('../../../shared/net/socketEvents');
const { inPartyOrder } = require('./partyOperations');
const { PARTY_STATUS } = require('./partyRules');
const { logIgnored } = require('../../lib/logIgnored');

const { partyBotSlotsFor } = require('./partyBotSlots');
const { normalizeSelectionFromRow, isSelectionQueueable, getSelectionBlockReason } = require('../match/gameSelectionCatalog');

async function setReady({ db, io, mm, partyPresence, partyQueueTransition, gameHub }, session, data) {
  const uname = session.user?.name;
  if (!uname) throw new Error("Please reconnect before readying up.");
  if (typeof data?.ready !== "boolean") throw new Error("Invalid ready state.");
  const isReady = data.ready;
  const providedPartyId = data?.partyId ? Number(data.partyId) : null;
  const partyId = Number(await db.getPartyIdByName(uname));
  if (!partyId || (providedPartyId && providedPartyId !== partyId)) {
    throw new Error("Your party changed. Please refresh the lobby.");
  }
  return inPartyOrder(db, partyId, async () => {
    if (isReady && !await hasLegalAcceptance(db, session.user.user_id)) throw new Error('Please review the Terms before readying up.');

    if (Number(await db.getPartyIdByName(uname)) !== partyId) {
      throw new Error("Your party changed. Please refresh the lobby.");
    }
    const partyRows = await db.runQuery(
      "SELECT * FROM parties WHERE party_id = ? LIMIT 1",
      [partyId],
    );
    if (!partyRows.length) throw new Error("Party not found.");
    let partyStatus = String(partyRows[0]?.status || PARTY_STATUS.IDLE).toLowerCase();
    if (partyStatus === PARTY_STATUS.LIVE) {
      const liveRows = await db.runQuery(
        `SELECT m.match_id
           FROM matches m
           JOIN match_participants mp ON mp.match_id = m.match_id
          WHERE mp.party_id = ? AND m.status = 'live'
          LIMIT 1`,
        [partyId],
      );
      if (!liveRows.length) {
        await db.setPartyStatus(partyId, PARTY_STATUS.IDLE);
        partyStatus = PARTY_STATUS.IDLE;
        console.warn(
          `[party:${partyId}] recovered stale live status during ready toggle`,
        );
      } else if (await gameHub?.endEmptyMatch(Number(liveRows[0].match_id))) {
        await db.setPartyStatus(partyId, PARTY_STATUS.IDLE);
        partyStatus = PARTY_STATUS.IDLE;
      } else {
        throw new Error("Your party is still in battle.");
      }
    }

    if ([PARTY_STATUS.QUEUED, PARTY_STATUS.READY_CHECK].includes(partyStatus)) {
      const tickets = await db.runQuery(
        "SELECT 1 FROM match_tickets WHERE party_id = ? LIMIT 1", [partyId],
      );
      const matches = await db.runQuery(
        `SELECT m.match_id FROM matches m
         JOIN match_participants mp ON mp.match_id = m.match_id
         WHERE mp.party_id = ? AND m.status IN ('queued', 'live') LIMIT 1`, [partyId],
      );
      if (!tickets.length && !matches.length) {
        await db.setPartyStatus(partyId, PARTY_STATUS.IDLE);
        partyStatus = PARTY_STATUS.IDLE;
      }
    }
    if (partyStatus === PARTY_STATUS.READY_CHECK && typeof mm.queueStatus === "function") {
      const queue = await mm.queueStatus({ partyId });
      if (queue.state === "missing") {
        await db.setPartyStatus(partyId, PARTY_STATUS.IDLE);
        partyStatus = PARTY_STATUS.IDLE;
      }
    }
    // Repeated ready requests must not requeue a claimed ticket.
    if (isReady && [PARTY_STATUS.QUEUED, PARTY_STATUS.READY_CHECK].includes(partyStatus)) {
      await partyPresence.emitPartyRosterById(partyId);
      return { ok: true, ready: true };
    }
    session.charMenuPrevStatus = null;

    if (!isReady && [PARTY_STATUS.QUEUED, PARTY_STATUS.READY_CHECK].includes(partyStatus)) {
      const result = await partyQueueTransition.cancelPartyQueue({
        partyId, userId: null, reason: `${uname} cancelled matchmaking`,
      });
      if (result?.cancelled === false) {
        return { ok: true, ready: true, cancelled: false, matchId: result.matchId };
      }
    }
    await partyPresence.setUserPresence(
      uname, isReady ? "ready" : "online", partyId, { strict: true },
    );

    const members = await db.fetchPartyMembersDetailed(partyId);
    const allReady =
      members.length > 0 &&
      members.every((m) => String(m.status || "").trim().toLowerCase() === "ready");
    if (
      allReady &&
      partyStatus === PARTY_STATUS.IDLE
    ) {
      try {
        const selection = normalizeSelectionFromRow(partyRows[0] || {});
        if (!isSelectionQueueable(selection)) {
          throw new Error(getSelectionBlockReason(selection));
        }
        const botSlots = partyBotSlotsFor(io || db).getPartyBotSlots(partyId);
        await db.setPartyStatus(partyId, PARTY_STATUS.QUEUED);
        await mm.queueJoin({
          partyId,
          modeId: selection.modeId,
          modeVariantId: selection.modeVariantId,
          map: selection.mapId,
          botSlots,
        });
        io.to(`party:${partyId}`).emit(SOCKET_EVENTS.PARTY_MATCHMAKING_START, {
          partyId,
          selection,
          botSlots,
        });
        console.log(`[party:${partyId}] all-ready -> matchmaking`);
      } catch (err) {
        console.warn("enqueue failed:", err?.message);
        try {
          await db.setPartyStatus(partyId, PARTY_STATUS.IDLE);
        } catch (error) { logIgnored("ready rollback", error); }
        await partyQueueTransition.cancelPartyQueue({
          partyId,
          reason: err?.message || "Failed to join matchmaking",
        });
        throw err;
      }
    }
    return { ok: true, ready: isReady };
  });
}

module.exports = { setReady };
