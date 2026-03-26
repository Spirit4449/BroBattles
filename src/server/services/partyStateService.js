const { updateOrDeleteParty } = require("../helpers/party");
const { PARTY_STATUS } = require("../helpers/constants");
const { capacityFromSelection } = require("../helpers/utils");
const {
  DEFAULT_MODE_ID,
  DEFAULT_VARIANT_ID,
  DEFAULT_MAP_ID,
  normalizeSelectionFromRow,
  selectionToLegacyMode,
} = require("../helpers/gameSelectionCatalog");

function createPartyStateService({ db, io }) {
  async function createPartyForUser(username) {
    return db.withTransaction(async (conn, q) => {
      await q("DELETE FROM party_members WHERE name = ?", [username]);
      const insertParty = await q(
        "INSERT INTO parties (status, mode, map, mode_id, mode_variant_id) VALUES (?, ?, ?, ?, ?)",
        [
          PARTY_STATUS.IDLE,
          selectionToLegacyMode(DEFAULT_MODE_ID, DEFAULT_VARIANT_ID),
          DEFAULT_MAP_ID,
          DEFAULT_MODE_ID,
          DEFAULT_VARIANT_ID,
        ],
      );
      const partyId = insertParty.insertId;
      await q(
        "INSERT INTO party_members (party_id, name, team) VALUES (?, ?, ?)",
        [partyId, username, "team1"],
      );
      return partyId;
    });
  }

  async function setPartyMode({ partyId, mode }) {
    const legacyMode = selectionToLegacyMode("duels", mode);
    await db.runQuery(
      "UPDATE parties SET mode = ?, mode_id = ?, mode_variant_id = ? WHERE party_id = ?",
      [legacyMode, "duels", mode, partyId],
    );
  }

  async function setPartyMap({ partyId, map }) {
    await db.runQuery("UPDATE parties SET map = ? WHERE party_id = ?", [
      map,
      partyId,
    ]);
  }

  async function setPartySelection({ partyId, selection }) {
    const normalized = normalizeSelectionFromRow({
      mode_id: selection?.modeId,
      mode_variant_id: selection?.modeVariantId,
      map: selection?.mapId,
    });
    const legacyMode = selectionToLegacyMode(
      normalized.modeId,
      normalized.modeVariantId,
    );
    await db.runQuery(
      "UPDATE parties SET mode = ?, map = ?, mode_id = ?, mode_variant_id = ? WHERE party_id = ?",
      [
        legacyMode,
        normalized.mapId ?? DEFAULT_MAP_ID,
        normalized.modeId,
        normalized.modeVariantId,
        partyId,
      ],
    );
    return normalized;
  }

  async function leaveParty({ partyId, username }) {
    const del = await db.runQuery(
      "DELETE FROM party_members WHERE party_id = ? AND name = ?",
      [partyId, username],
    );
    if (!del?.affectedRows) {
      return { left: false, deleted: false };
    }
    const deleted = await updateOrDeleteParty(io, db, partyId);
    return { left: true, deleted };
  }

  async function joinPartyAndGetData({ partyId, username }) {
    let conn;
    try {
      conn = await db.pool.getConnection();
      await conn.beginTransaction();

      const [partyRows] = await conn.query(
        "SELECT * FROM parties WHERE party_id = ? FOR UPDATE",
        [partyId],
      );
      if (!partyRows.length) {
        await conn.rollback();
        return {
          ok: false,
          statusCode: 404,
          payload: { error: "Party not found", redirect: "/partynotfound" },
        };
      }

      const party = partyRows[0];
      const selection = normalizeSelectionFromRow(party || {});
      const { total: totalCap, perTeam: perTeamCap } = capacityFromSelection(
        selection,
      );

      const [existing] = await conn.query(
        "SELECT team FROM party_members WHERE party_id = ? AND name = ? LIMIT 1",
        [partyId, username],
      );
      let joinedNow = false;

      if (!existing.length) {
        const [[{ cnt: currentCount }]] = await conn.query(
          "SELECT COUNT(*) AS cnt FROM party_members WHERE party_id = ? FOR UPDATE",
          [partyId],
        );
        if (currentCount >= totalCap) {
          await conn.rollback();
          console.log("[party] join-reject", {
            username,
            partyId,
            currentCount,
            totalCap,
          });
          return {
            ok: false,
            statusCode: 409,
            payload: { error: "Party is full", redirect: "/partyfull" },
          };
        }

        const [teamCounts] = await conn.query(
          "SELECT team, COUNT(*) AS c FROM party_members WHERE party_id = ? GROUP BY team FOR UPDATE",
          [partyId],
        );
        const map = new Map(teamCounts.map((r) => [r.team, Number(r.c)]));
        const team1Count = map.get("team1") || 0;
        const team2Count = map.get("team2") || 0;

        let chosen = team1Count > team2Count ? "team2" : "team1";
        if (
          (chosen === "team1" && team1Count >= perTeamCap) ||
          (chosen === "team2" && team2Count >= perTeamCap)
        ) {
          chosen = chosen === "team1" ? "team2" : "team1";
        }
        if (
          (chosen === "team1" && team1Count >= perTeamCap) ||
          (chosen === "team2" && team2Count >= perTeamCap)
        ) {
          await conn.rollback();
          return {
            ok: false,
            statusCode: 409,
            payload: { error: "Party is full", redirect: "/partyfull" },
          };
        }

        await conn.query(
          "DELETE FROM party_members WHERE name = ? AND party_id <> ?",
          [username, partyId],
        );
        try {
          await conn.query(
            "INSERT INTO party_members (party_id, name, team, joined_at) VALUES (?, ?, ?, NOW())",
            [partyId, username, chosen],
          );
          console.log("[party] join", { username, partyId, team: chosen });
          joinedNow = true;
        } catch (e) {
          if (!(e && e.code === "ER_DUP_ENTRY")) {
            await conn.rollback();
            return {
              ok: false,
              statusCode: 500,
              payload: { error: "Could not join party" },
            };
          }
        }
      } else {
        console.log("[party] already-in", { username, partyId });
      }

      await conn.query(
        "UPDATE party_members SET last_seen = NOW() WHERE party_id = ? AND name = ?",
        [partyId, username],
      );

      const [memberRows] = await conn.query(
        `SELECT pm.name, pm.team, u.char_class, u.status
           FROM party_members pm
           LEFT JOIN users u ON u.name = pm.name
          WHERE pm.party_id = ?
          ORDER BY pm.joined_at, pm.name`,
        [partyId],
      );

      await conn.commit();
      return {
        ok: true,
        party,
        selection: normalizeSelectionFromRow(party || {}),
        members: memberRows,
        capacity: { total: totalCap, perTeam: perTeamCap },
        joinedNow,
      };
    } finally {
      if (conn) conn.release();
    }
  }

  return {
    createPartyForUser,
    setPartyMode,
    setPartyMap,
    setPartySelection,
    leaveParty,
    joinPartyAndGetData,
  };
}

module.exports = { createPartyStateService };
