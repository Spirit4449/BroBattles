const { updateOrDeleteParty } = require("../helpers/party");
const { PARTY_STATUS } = require("../helpers/partyRules");
const { capacityFromSelection } = require("../helpers/utils");
const {
  DEFAULT_MODE_ID,
  DEFAULT_VARIANT_ID,
  DEFAULT_MAP_ID,
  normalizeSelectionFromRow,
  selectionToLegacyMode,
} = require("../helpers/gameSelectionCatalog");

function createPartyStateService({ db, io }) {
  function isMissingModeSelectionColumn(error) {
    return (
      error?.code === "ER_BAD_FIELD_ERROR" &&
      /mode_id|mode_variant_id/i.test(
        String(error?.sqlMessage || error?.message || ""),
      )
    );
  }

  function isMissingPartyVisibilityColumn(error) {
    return (
      error?.code === "ER_BAD_FIELD_ERROR" &&
      /is_public|public_name/i.test(
        String(error?.sqlMessage || error?.message || ""),
      )
    );
  }

  async function updatePartySelectionWithFallback(
    partyId,
    normalizedSelection,
  ) {
    const legacyMode = selectionToLegacyMode(
      normalizedSelection.modeId,
      normalizedSelection.modeVariantId,
    );
    const mapId = normalizedSelection.mapId ?? DEFAULT_MAP_ID;

    try {
      await db.runQuery(
        "UPDATE parties SET mode = ?, map = ?, mode_id = ?, mode_variant_id = ? WHERE party_id = ?",
        [
          legacyMode,
          mapId,
          normalizedSelection.modeId,
          normalizedSelection.modeVariantId,
          partyId,
        ],
      );
    } catch (error) {
      if (!isMissingModeSelectionColumn(error)) throw error;
      await db.runQuery(
        "UPDATE parties SET mode = ?, map = ? WHERE party_id = ?",
        [legacyMode, mapId, partyId],
      );
    }
  }

  async function createPartyForUser(username) {
    return db.withTransaction(async (conn, q) => {
      await q("DELETE FROM party_members WHERE name = ?", [username]);
      let insertParty;
      try {
        insertParty = await q(
          "INSERT INTO parties (status, mode, map, mode_id, mode_variant_id, is_public, public_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            PARTY_STATUS.IDLE,
            selectionToLegacyMode(DEFAULT_MODE_ID, DEFAULT_VARIANT_ID),
            DEFAULT_MAP_ID,
            DEFAULT_MODE_ID,
            DEFAULT_VARIANT_ID,
            0,
            null,
          ],
        );
      } catch (error) {
        if (!isMissingModeSelectionColumn(error)) {
          if (!isMissingPartyVisibilityColumn(error)) throw error;
          try {
            insertParty = await q(
              "INSERT INTO parties (status, mode, map, mode_id, mode_variant_id) VALUES (?, ?, ?, ?, ?)",
              [
                PARTY_STATUS.IDLE,
                selectionToLegacyMode(DEFAULT_MODE_ID, DEFAULT_VARIANT_ID),
                DEFAULT_MAP_ID,
                DEFAULT_MODE_ID,
                DEFAULT_VARIANT_ID,
              ],
            );
          } catch (nestedError) {
            if (!isMissingModeSelectionColumn(nestedError)) throw nestedError;
            insertParty = await q(
              "INSERT INTO parties (status, mode, map) VALUES (?, ?, ?)",
              [
                PARTY_STATUS.IDLE,
                selectionToLegacyMode(DEFAULT_MODE_ID, DEFAULT_VARIANT_ID),
                DEFAULT_MAP_ID,
              ],
            );
          }
        } else {
          insertParty = await q(
            "INSERT INTO parties (status, mode, map) VALUES (?, ?, ?)",
            [
              PARTY_STATUS.IDLE,
              selectionToLegacyMode(DEFAULT_MODE_ID, DEFAULT_VARIANT_ID),
              DEFAULT_MAP_ID,
            ],
          );
        }
      }
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
    try {
      await db.runQuery(
        "UPDATE parties SET mode = ?, mode_id = ?, mode_variant_id = ? WHERE party_id = ?",
        [legacyMode, "duels", mode, partyId],
      );
    } catch (error) {
      if (!isMissingModeSelectionColumn(error)) throw error;
      await db.runQuery("UPDATE parties SET mode = ? WHERE party_id = ?", [
        legacyMode,
        partyId,
      ]);
    }
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
    await updatePartySelectionWithFallback(partyId, normalized);
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

  async function getPartyOwnerName(partyId) {
    const rows = await db.runQuery(
      `SELECT name
         FROM party_members
        WHERE party_id = ?
        ORDER BY joined_at ASC, name ASC
        LIMIT 1`,
      [partyId],
    );
    return rows?.[0]?.name || null;
  }

  async function kickMember({ partyId, actorName, targetName }) {
    if (!partyId || !actorName || !targetName) {
      return { ok: false, error: "Missing party action data." };
    }
    if (actorName === targetName) {
      return { ok: false, error: "Use leave party for yourself." };
    }
    const ownerName = await getPartyOwnerName(partyId);
    if (ownerName !== actorName) {
      return { ok: false, error: "Only the party owner can kick members." };
    }
    const result = await db.runQuery(
      "DELETE FROM party_members WHERE party_id = ? AND name = ?",
      [partyId, targetName],
    );
    if (!result?.affectedRows) {
      return { ok: false, error: "That player is no longer in the party." };
    }
    const deleted = await updateOrDeleteParty(io, db, partyId);
    return { ok: true, deleted };
  }

  async function makeOwner({ partyId, actorName, targetName }) {
    if (!partyId || !actorName || !targetName) {
      return { ok: false, error: "Missing party action data." };
    }
    const ownerName = await getPartyOwnerName(partyId);
    if (ownerName !== actorName) {
      return {
        ok: false,
        error: "Only the party owner can transfer ownership.",
      };
    }
    if (ownerName === targetName) {
      return { ok: true };
    }
    const targetRows = await db.runQuery(
      "SELECT 1 AS ok FROM party_members WHERE party_id = ? AND name = ? LIMIT 1",
      [partyId, targetName],
    );
    if (!targetRows.length) {
      return { ok: false, error: "That player is no longer in the party." };
    }
    await db.runQuery(
      `UPDATE party_members
          SET joined_at = DATE_SUB((
            SELECT oldest.joined_at
              FROM (
                SELECT joined_at
                  FROM party_members
                 WHERE party_id = ?
                 ORDER BY joined_at ASC, name ASC
                 LIMIT 1
              ) AS oldest
          ), INTERVAL 1 SECOND)
        WHERE party_id = ? AND name = ?`,
      [partyId, partyId, targetName],
    );
    await updateOrDeleteParty(io, db, partyId);
    return { ok: true };
  }

  async function setPartyVisibility({
    partyId,
    actorName,
    isPublic,
    publicName,
  }) {
    if (!partyId || !actorName) {
      return { ok: false, error: "Missing party action data." };
    }

    const ownerName = await getPartyOwnerName(partyId);
    if (ownerName !== actorName) {
      return {
        ok: false,
        error: "Only the party owner can update party settings.",
      };
    }

    const normalizedPublic = !!isPublic;
    const normalizedName = String(publicName || "").trim();
    if (normalizedPublic && normalizedName.length < 3) {
      return {
        ok: false,
        error: "Public party names must be at least 3 characters.",
      };
    }
    if (normalizedPublic && normalizedName.length > 32) {
      return {
        ok: false,
        error: "Public party names must be 32 characters or fewer.",
      };
    }

    try {
      await db.runQuery(
        "UPDATE parties SET is_public = ?, public_name = ? WHERE party_id = ?",
        [
          normalizedPublic ? 1 : 0,
          normalizedPublic ? normalizedName : null,
          partyId,
        ],
      );
    } catch (error) {
      if (isMissingPartyVisibilityColumn(error)) {
        return {
          ok: false,
          statusCode: 500,
          error:
            "Party visibility columns are missing. Apply the party discovery migration first.",
        };
      }
      throw error;
    }

    await updateOrDeleteParty(io, db, partyId);
    const rows = await db.runQuery(
      "SELECT is_public, public_name FROM parties WHERE party_id = ? LIMIT 1",
      [partyId],
    );
    return {
      ok: true,
      settings: {
        isPublic: Number(rows?.[0]?.is_public || 0) === 1,
        publicName: String(rows?.[0]?.public_name || "").trim(),
      },
    };
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
      const { total: totalCap, perTeam: perTeamCap } =
        capacityFromSelection(selection);

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
        ownerName: await getPartyOwnerName(partyId),
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
    kickMember,
    makeOwner,
    setPartyVisibility,
    joinPartyAndGetData,
  };
}

module.exports = { createPartyStateService };
