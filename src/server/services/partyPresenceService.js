const { emitRoster, selectPartyById } = require("../helpers/party");

function createPartyPresenceService({ db, io }) {
  async function setUserPresence(name, status, partyId = null) {
    try {
      await db.setUserStatus(name, status);
      const targetPartyId = partyId || (await db.getPartyIdByName(name));
      if (targetPartyId) {
        io.to(`party:${targetPartyId}`).emit("status:update", {
          partyId: targetPartyId,
          name,
          status,
        });
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
  };
}

module.exports = { createPartyPresenceService };
