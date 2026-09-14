const { capacityFromSelection } = require("../helpers/utils");
const { selectPartyById, getPartyOwnerName } = require("../helpers/party");
const {
  normalizeSelectionFromRow,
} = require("../helpers/gameSelectionCatalog");
const {
  normalizeSelectedSkinMap,
  resolveSelectedSkinId,
  buildSkinAssetUrl,
} = require("../helpers/skinsCatalog");

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

    const membersRaw = await db.fetchPartyMembersDetailed(partyId);
    const members = (Array.isArray(membersRaw) ? membersRaw : []).map((m) => {
      const character = String(m?.char_class || "ninja").toLowerCase();
      const selectedSkinId = resolveSelectedSkinId({
        character,
        selectedSkinMap: normalizeSelectedSkinMap(m?.selected_skin_id_by_char),
      });
      return {
        ...m,
        selected_skin_id: selectedSkinId || null,
        selected_skin_asset_url: buildSkinAssetUrl(character, selectedSkinId),
      };
    });
    const selection = normalizeSelectionFromRow(party || {});
    const ownerName = await getPartyOwnerName(db, partyId);
    return {
      ok: true,
      payload: {
        partyId: party.party_id,
        ownerName,
        allowMemberSelection: Number(party?.allow_member_selection ?? 1) === 1,
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
        "SELECT * FROM parties WHERE party_id = ? LIMIT 1",
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
          allowMemberSelection: Number(rows[0]?.allow_member_selection ?? 1) === 1,
          memberSelectionSupported: rows[0]?.allow_member_selection != null,
          visibilitySupported: rows[0]?.is_public != null,
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

  async function discoverPublicParties({
    query,
    requesterName,
    requesterTrophies,
    limit = 30,
  }) {
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
           p.status AS party_status,
           p.created_at AS party_created_at,
           pm.name,
           pm.team,
           pm.joined_at,
           pm.last_seen,
           u.char_class,
           u.selected_skin_id_by_char,
           u.selected_profile_icon_id AS profile_icon_id,
           u.trophies,
           CASE
             WHEN pm.last_seen IS NULL
               OR pm.last_seen < DATE_SUB(NOW(), INTERVAL 45 SECOND)
             THEN 'offline'
             ELSE COALESCE(u.status, 'online')
           END AS status,
           COALESCE(pa.battle_count, 0) AS party_battle_count,
           pa.last_battle_at,
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
         LEFT JOIN (
           SELECT
             mp.party_id,
             COUNT(DISTINCT m.match_id) AS battle_count,
             MAX(m.created_at) AS last_battle_at
           FROM match_participants mp
           JOIN matches m ON m.match_id = mp.match_id
           WHERE mp.party_id IS NOT NULL AND m.status = 'completed'
           GROUP BY mp.party_id
         ) pa ON pa.party_id = p.party_id
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
          status: String(row.party_status || "idle"),
          createdAt: row.party_created_at || null,
          battleCount: Math.max(0, Number(row.party_battle_count) || 0),
          lastBattleAt: row.last_battle_at || null,
          ownerName: null,
          members: [],
        });
      }
      const party = byParty.get(partyId);
      const member = {
        name: String(row.name || ""),
        team: String(row.team || "team1"),
        char_class: String(row.char_class || "ninja"),
        selected_skin_id: null,
        selected_skin_asset_url: null,
        profile_icon_id: String(row.profile_icon_id || "") || null,
        status: String(row.status || "online"),
        trophies: Math.max(0, Number(row.trophies) || 0),
        joinedAt: row.joined_at || null,
      };
      const selectedSkinMap = normalizeSelectedSkinMap(
        row.selected_skin_id_by_char,
      );
      const selectedSkinId = resolveSelectedSkinId({
        character: member.char_class,
        selectedSkinMap,
      });
      member.selected_skin_id = selectedSkinId || null;
      member.selected_skin_asset_url = buildSkinAssetUrl(
        member.char_class,
        selectedSkinId,
      );
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

    const targetSkill = Math.max(0, Number(requesterTrophies) || 0);
    parties = parties
      .map((party) => {
        const ratings = party.members.map((member) => member.trophies);
        const skillRating = ratings.length
          ? Math.round(
              ratings.reduce((sum, value) => sum + value, 0) / ratings.length,
            )
          : 0;
        return {
          ...party,
          skillRating,
          skillGap: Math.abs(skillRating - targetSkill),
        };
      })
      .sort((left, right) =>
        left.skillGap - right.skillGap || right.partyId - left.partyId,
      );

    parties = parties.map((party) => {
      const capacity = capacityFromSelection(normalizeSelectionFromRow(party));
      const capacityTotal = Math.max(1, Number(capacity?.total) || 2);
      const activeMembers = party.members.filter(
        (member) => member.status.toLowerCase() !== "offline",
      ).length;
      const suggestionEligible =
        party.status === "idle" &&
        party.battleCount >= 1 &&
        party.members.length >= 1 &&
        party.members.length < capacityTotal &&
        activeMembers >= 1;
      const skillFit = Math.max(0, 100 - Math.floor(party.skillGap / 20));
      return {
        ...party,
        capacity: capacityTotal,
        activeMembers,
        membersCount: party.members.length,
        suggestionEligible,
        suggestionScore:
          skillFit + activeMembers * 25 + Math.min(party.battleCount, 5) * 10,
      };
    });
    parties.sort(
      (left, right) =>
        Number(right.suggestionEligible) - Number(left.suggestionEligible) ||
        right.suggestionScore - left.suggestionScore ||
        left.skillGap - right.skillGap ||
        right.partyId - left.partyId,
    );
    parties = parties.slice(0, maxRows);

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
