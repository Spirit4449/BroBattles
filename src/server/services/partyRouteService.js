const { capacityFromMode } = require("../helpers/utils");
const { selectPartyById } = require("../helpers/party");

function createPartyRouteService({ db }) {
  async function getPartyMembersView({ username, partyId }) {
    if (!partyId) {
      return {
        ok: false,
        statusCode: 400,
        payload: { error: "Party ID required" },
      };
    }

    const membership = await db.runQuery(
      "SELECT 1 FROM party_members WHERE name = ? AND party_id = ? LIMIT 1",
      [username, partyId],
    );
    if (!membership.length) {
      return {
        ok: false,
        statusCode: 403,
        payload: { error: "Not a member of this party" },
      };
    }

    const party = await selectPartyById(db, partyId);
    if (!party) {
      return {
        ok: false,
        statusCode: 404,
        payload: { error: "Party not found" },
      };
    }

    const members = await db.fetchPartyMembersDetailed(partyId);
    return {
      ok: true,
      payload: {
        partyId: party.party_id,
        mode: party.mode,
        map: party.map,
        members,
        membersCount: members.length,
        capacity: capacityFromMode(party.mode),
      },
    };
  }

  async function resolveLeavePartyId({ username, partyId }) {
    if (partyId) return partyId;
    const rows = await db.runQuery(
      "SELECT party_id FROM party_members WHERE name = ? LIMIT 1",
      [username],
    );
    if (!rows.length) return null;
    return rows[0].party_id;
  }

  return {
    getPartyMembersView,
    resolveLeavePartyId,
  };
}

module.exports = { createPartyRouteService };
