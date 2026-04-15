const { capacityFromSelection } = require("../helpers/utils");
const { selectPartyById, getPartyOwnerName } = require("../helpers/party");
const {
  normalizeSelectionFromRow,
} = require("../helpers/gameSelectionCatalog");

function createPartyRouteService({ db }) {
  function isMissingPartyVisibilityColumn(error) {
    return (
      error?.code === "ER_BAD_FIELD_ERROR" &&
      /is_public|public_name/i.test(
        String(error?.sqlMessage || error?.message || ""),
      )
    );
  }

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
    const selection = normalizeSelectionFromRow(party || {});
    const ownerName = await getPartyOwnerName(db, partyId);
    return {
      ok: true,
      payload: {
        partyId: party.party_id,
        ownerName,
        mode: party.mode,
        modeId: selection.modeId,
        modeVariantId: selection.modeVariantId,
        selection,
        map: selection.mapId,
        members,
        membersCount: members.length,
        capacity: capacityFromSelection(selection),
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

  async function getPartySettingsView({ username, partyId }) {
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

    const ownerName = await getPartyOwnerName(db, partyId);

    try {
      const rows = await db.runQuery(
        "SELECT is_public, public_name FROM parties WHERE party_id = ? LIMIT 1",
        [partyId],
      );
      if (!rows.length) {
        return {
          ok: false,
          statusCode: 404,
          payload: { error: "Party not found" },
        };
      }
      return {
        ok: true,
        payload: {
          partyId,
          ownerName,
          isOwner: ownerName === username,
          isPublic: Number(rows[0]?.is_public || 0) === 1,
          publicName: String(rows[0]?.public_name || "").trim(),
        },
      };
    } catch (error) {
      if (isMissingPartyVisibilityColumn(error)) {
        return {
          ok: true,
          payload: {
            partyId,
            ownerName,
            isOwner: ownerName === username,
            isPublic: false,
            publicName: "",
            visibilitySupported: false,
          },
        };
      }
      throw error;
    }
  }

  async function discoverPublicParties({ query, requesterName, limit = 30 }) {
    const normalizedQuery = String(query || "").trim();
    const maxRows = Math.max(1, Math.min(100, Number(limit) || 30));

    let rows;
    try {
      rows = await db.runQuery(
        `SELECT
           p.party_id,
           p.mode,
           p.map,
           p.mode_id,
           p.mode_variant_id,
           p.public_name,
           pm.name,
           pm.team,
           u.char_class,
           u.selected_profile_icon_id AS profile_icon_id,
           u.status,
           CASE
             WHEN pm.joined_at = (
               SELECT MIN(pm2.joined_at)
               FROM party_members pm2
               WHERE pm2.party_id = p.party_id
             ) THEN 1
             ELSE 0
           END AS is_owner
         FROM parties p
         JOIN party_members pm ON pm.party_id = p.party_id
         LEFT JOIN users u ON u.name = pm.name
         WHERE p.is_public = 1
         ORDER BY p.party_id DESC, pm.joined_at ASC, pm.name ASC
         LIMIT ?`,
        [maxRows * 8],
      );
    } catch (error) {
      if (isMissingPartyVisibilityColumn(error)) {
        return {
          ok: true,
          payload: {
            parties: [],
            visibilitySupported: false,
          },
        };
      }
      throw error;
    }

    const byParty = new Map();
    for (const row of rows) {
      const partyId = Number(row.party_id);
      if (!Number.isFinite(partyId) || partyId <= 0) continue;
      if (!byParty.has(partyId)) {
        byParty.set(partyId, {
          partyId,
          mode: row.mode,
          map: row.map,
          modeId: row.mode_id,
          modeVariantId: row.mode_variant_id,
          publicName: String(row.public_name || "").trim(),
          ownerName: null,
          members: [],
        });
      }
      const party = byParty.get(partyId);
      const member = {
        name: String(row.name || ""),
        team: String(row.team || "team1"),
        char_class: String(row.char_class || "ninja"),
        profile_icon_id: String(row.profile_icon_id || "") || null,
        status: String(row.status || "online"),
      };
      if (member.name) {
        party.members.push(member);
      }
      if (Number(row.is_owner) === 1 && member.name) {
        party.ownerName = member.name;
      }
    }

    let parties = Array.from(byParty.values());
    if (normalizedQuery) {
      const q = normalizedQuery.toLowerCase();
      parties = parties.filter((party) => {
        const haystack = [
          party.publicName,
          party.ownerName,
          ...party.members.map((member) => member.name),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    if (requesterName) {
      parties = parties.filter(
        (party) =>
          !party.members.some((member) => member.name === requesterName),
      );
    }

    parties = parties.slice(0, maxRows).map((party) => ({
      ...party,
      membersCount: party.members.length,
    }));

    return {
      ok: true,
      payload: {
        parties,
        visibilitySupported: true,
      },
    };
  }

  return {
    getPartyMembersView,
    resolveLeavePartyId,
    getPartySettingsView,
    discoverPublicParties,
  };
}

module.exports = { createPartyRouteService };
