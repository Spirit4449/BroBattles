const { logIgnored } = require("../../lib/logIgnored");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { appendPartyChatLog } = require("./partyChatLog");
const { emitRoster, selectPartyById } = require("./party");

function createPartyPresenceService({ db, io }) {
  const restores = new Map();
  let disposed = false;
  async function setUserPresence(name, status, partyId = null, { strict = false } = {}) {
    try {
      await db.setUserStatus(name, status);
      if (partyId) {
        try {
          await db.updateLastSeen(partyId, name);
        } catch (error) { logIgnored("party last seen", error); }
      }
      const targetPartyId = partyId || (await db.getPartyIdByName(name));
      if (targetPartyId) {
        io.to(`party:${targetPartyId}`).emit(SOCKET_EVENTS.STATUS_UPDATE, {
          partyId: targetPartyId,
          name,
          status,
        });
        await emitPartyRosterById(targetPartyId);
      }
    } catch (error) {
      if (strict) throw error;
      logIgnored("party presence", error);
    }
  }

  async function setTransientPresence({
    name,
    status,
    restoreStatus,
    partyId,
    durationMs = 1500,
  }) {
    await setUserPresence(name, status, partyId || null);
    if (disposed) return;
    clearTimeout(restores.get(name));
    const timer = setTimeout(() => {
      restores.delete(name);
      void setUserPresence(name, restoreStatus, partyId || null);
    }, durationMs);
    timer.unref?.();
    restores.set(name, timer);
  }

  async function emitPartyRosterById(partyId) {
    if (!partyId) return;
    const party = await selectPartyById(db, partyId);
    if (!party) return;
    const members = await db.fetchPartyMembersDetailed(partyId);
    await emitRoster(io, partyId, party, members, db);
  }

  return {
    dispose() { disposed = true; for (const timer of restores.values()) clearTimeout(timer); restores.clear(); },
    setUserPresence,
    setTransientPresence,
    emitPartyRosterById,
    emitPartyNotice: (partyId, notice) => {
      if (!partyId) return;
      if (["map", "mode"].includes(notice?.type)) {
        appendPartyChatLog(io, partyId, { kind: notice.type, body: notice.title });
      }
      io.to(`party:${partyId}`).emit(SOCKET_EVENTS.PARTY_NOTICE, { ...notice, partyId });
    },
  };
}

module.exports = { createPartyPresenceService };
