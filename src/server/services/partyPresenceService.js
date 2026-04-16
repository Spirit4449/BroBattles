const { emitRoster, selectPartyById } = require("../helpers/party");

function createPartyPresenceService({ db, io }) {
  async function setUserPresence(name, status, partyId = null) {
    try {
      await db.setUserStatus(name, status);
      if (partyId) {
        try {
          await db.updateLastSeen(partyId, name);
        } catch (_) {}
      }
      const targetPartyId = partyId || (await db.getPartyIdByName(name));
      if (targetPartyId) {
        io.to(`party:${targetPartyId}`).emit("status:update", {
          partyId: targetPartyId,
          name,
          status,
        });
        await emitPartyRosterById(targetPartyId);
      }
    } catch (_) {}
  }

  async function setTransientPresence({
    name,
    status,
    restoreStatus,
    partyId,
    durationMs = 1500,
  }) {
    await setUserPresence(name, status, partyId || null);
    setTimeout(() => {
      void setUserPresence(name, restoreStatus, partyId || null);
    }, durationMs);
  }

  async function emitPartyRosterById(partyId) {
    if (!partyId) return;
    const party = await selectPartyById(db, partyId);
    if (!party) return;
    const members = await db.fetchPartyMembersDetailed(partyId);
    await emitRoster(io, partyId, party, members, db);
  }

  return {
    setUserPresence,
    setTransientPresence,
    emitPartyRosterById,
    emitPartyNotice: (partyId, notice) => {
      if (!partyId) return;
      io.to(`party:${partyId}`).emit("party:notice", notice);
    },
  };
}

module.exports = { createPartyPresenceService };
