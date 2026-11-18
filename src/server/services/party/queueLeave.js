const { SOCKET_EVENTS } = require('../../../shared/net/socketEvents');
const { logIgnored } = require('../../lib/logIgnored');
const { PARTY_STATUS } = require('./partyRules');

async function resetPartyAfterQueue(db, io, pid) {
  try {
    await db.setPartyStatus(pid, PARTY_STATUS.IDLE);
  } catch (error) { logIgnored("queue leave party idle", error); }
  try {
    const members = await db.fetchPartyMembersDetailed(pid);
    for (const m of members || []) {
      if (!m?.name || !m.status || String(m.status).trim().toLowerCase() === "offline") continue;
      try {
        await db.setUserStatus(m.name, "online");
      } catch (error) { logIgnored("queue leave participant state", error); }
      io.to(`party:${pid}`).emit(SOCKET_EVENTS.STATUS_UPDATE, {
        partyId: pid,
        name: m.name,
        status: "online",
      });
    }
  } catch (error) { logIgnored("queue leave ticket cleanup", error); }
}
module.exports = { resetPartyAfterQueue };
