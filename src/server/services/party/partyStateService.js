const { resizePartySlots } = require("./partySlots");
const { PARTY_NAME_MIN, PARTY_NAME_MAX } = require("../../../shared/social/textRules.js");
const { updateOrDeleteParty } = require("./party");
const { PARTY_STATUS, capacityFromSelection } = require("./partyRules");
const {
  DEFAULT_MAP_ID,
  normalizeSelection,
  normalizeSelectionFromRow,
  selectionToLegacyMode,
} = require("../match/gameSelectionCatalog");
const { hasPartyInvite, consumePartyInvite } = require("./partyInviteStore");
const { failure } = require("../serviceResult");
const { createPartyJoinRequestService } = require("./partyJoinRequestService");

function createPartyStateService({ db, io }) {
  const {
    buildJoinRequestState,
    isJoinRequestTimedOut,
    getJoinRequestRowByUserId,
    getPendingJoinRequests,
    submitJoinRequest,
    respondToJoinRequest,
  } = createPartyJoinRequestService({ db, io, getPartyOwnerName });

  async function updatePartySelection(
    partyId,
    normalizedSelection,
    query = db.runQuery.bind(db),
  ) {
    const legacyMode = selectionToLegacyMode(
      normalizedSelection.modeId,
      normalizedSelection.modeVariantId,
    );
    const mapId = normalizedSelection.mapId ?? DEFAULT_MAP_ID;

    await query(
      "UPDATE parties SET mode = ?, map = ?, mode_id = ?, mode_variant_id = ? WHERE party_id = ?",
      [
        legacyMode,
        mapId,
        normalizedSelection.modeId,
        normalizedSelection.modeVariantId,
        partyId,
      ],
    );
  }

  async function createPartyForUser(username, selection = null) {
    const initialSelection = normalizeSelection(selection || {});
    const initialLegacyMode = selectionToLegacyMode(
      initialSelection.modeId,
      initialSelection.modeVariantId,
    );
    const initialMapId = initialSelection.mapId ?? DEFAULT_MAP_ID;

    return db.withTransaction(async (conn, q) => {
      await q("DELETE FROM party_members WHERE name = ?", [username]);
      const insertParty = await q(
        "INSERT INTO parties (status, mode, map, mode_id, mode_variant_id, is_public, public_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          PARTY_STATUS.IDLE,
          initialLegacyMode,
          initialMapId,
          initialSelection.modeId,
          initialSelection.modeVariantId,
          0,
          null,
        ],
      );
      const partyId = insertParty.insertId;
      await q(
        "INSERT INTO party_members (party_id, name, team, joined_at) VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL 1 SECOND))",
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

  async function setPartySelection({ partyId, selection, actorName }) {
    const membership = actorName
      ? await db.runQuery(
          "SELECT 1 FROM party_members WHERE party_id = ? AND name = ? LIMIT 1",
          [partyId, actorName],
        )
      : [];
    if (!membership.length) throw new Error("Not a member of this party.");
    const rows = await db.runQuery(
      "SELECT * FROM parties WHERE party_id = ? LIMIT 1",
      [partyId],
    );
    if (!rows.length) throw new Error("Party not found.");
    if (
      Number(rows[0].allow_member_selection ?? 1) !== 1 &&
      (await getPartyOwnerName(partyId)) !== actorName
    ) {
      throw new Error("Only the party owner can change the map and mode.");
    }
    const normalized = normalizeSelectionFromRow({
      mode_id: selection?.modeId,
      mode_variant_id: selection?.modeVariantId,
      map: selection?.mapId,
    });
    await require("../trophies/trophyModeAccess").assertModeAccess(db, normalized.modeId, { actorName });
    await db.withTransaction(async (conn, q) => {
      await q("SELECT party_id FROM parties WHERE party_id = ? FOR UPDATE", [partyId]);
      const members = await q(
        "SELECT name, team, slot_index FROM party_members WHERE party_id = ? ORDER BY joined_at, name FOR UPDATE",
        [partyId],
      );
      const { perTeam: teamSize } = capacityFromSelection(normalized);
      const next = resizePartySlots(members, teamSize);
      for (let i = 0; i < next.length; i++) {
        if (next[i].team === members[i].team && next[i].slot_index === members[i].slot_index) continue;
        await q("UPDATE party_members SET team = ?, slot_index = ? WHERE party_id = ? AND name = ?",
          [next[i].team, next[i].slot_index, partyId, next[i].name]);
      }
      await updatePartySelection(partyId, normalized, q);
    });
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
    allowMemberSelection,
    hideEnemyBros,
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
    if (normalizedPublic && normalizedName.length < PARTY_NAME_MIN) {
      return {
        ok: false,
        error: `Public party names must be at least ${PARTY_NAME_MIN} characters.`,
      };
    }
    if (normalizedPublic && normalizedName.length > PARTY_NAME_MAX) {
      return {
        ok: false,
        error: `Public party names must be ${PARTY_NAME_MAX} characters or fewer.`,
      };
    }

    await db.runQuery(
      `UPDATE parties SET is_public = ?, public_name = ?${
        typeof allowMemberSelection === "boolean"
          ? ", allow_member_selection = ?"
          : ""
      }${typeof hideEnemyBros === "boolean" ? ", hide_enemy_bros = ?" : ""} WHERE party_id = ?`,
      [
        normalizedPublic ? 1 : 0,
        normalizedPublic ? normalizedName : null,
        ...(typeof allowMemberSelection === "boolean"
          ? [allowMemberSelection ? 1 : 0]
          : []),
        ...(typeof hideEnemyBros === "boolean" ? [hideEnemyBros ? 1 : 0] : []),
        partyId,
      ],
    );

    await updateOrDeleteParty(io, db, partyId);
    const rows = await db.runQuery(
      "SELECT * FROM parties WHERE party_id = ? LIMIT 1",
      [partyId],
    );
    return {
      ok: true,
      settings: {
        isPublic: Number(rows?.[0]?.is_public || 0) === 1,
        publicName: String(rows?.[0]?.public_name || "").trim(),
        allowMemberSelection: Number(rows?.[0]?.allow_member_selection ?? 1) === 1,
        hideEnemyBros: Number(rows?.[0]?.hide_enemy_bros ?? 0) === 1,
      },
    };
  }

  async function joinPartyAndGetData({ partyId, username, userId }) {
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
        return failure(404, { error: "Party not found", redirect: "/partynotfound" });
      }

      const party = partyRows[0];
      const selection = normalizeSelectionFromRow(party || {});
      const { total: totalCap, perTeam: perTeamCap } =
        capacityFromSelection(selection);
      const partyIsPublic = Number(party.is_public || 0) === 1;

      const [existing] = await conn.query(
        "SELECT team FROM party_members WHERE party_id = ? AND name = ? LIMIT 1",
        [partyId, username],
      );
      let joinedNow = false;

      if (!existing.length) {
        const requestRow = await getJoinRequestRowByUserId(conn, partyId, userId);
        if (requestRow && isJoinRequestTimedOut(requestRow)) {
          await conn.query(
            `UPDATE party_join_requests
                SET status = 'expired',
                    responded_at = CURRENT_TIMESTAMP
              WHERE request_id = ?`,
            [requestRow.request_id],
          );
          requestRow.status = "expired";
          requestRow.responded_at = new Date();
        }

        // A friend's in-app invite admits the invitee without a join request.
        const invitedByFriend = hasPartyInvite(userId, partyId);

        if (!partyIsPublic && !invitedByFriend && String(requestRow?.status || "") !== "accepted") {
          const members = await db.fetchPartyMembersDetailed(partyId);
          await conn.rollback();
          return {
            ok: false,
            statusCode: 403,
            payload: {
              error:
                "This party is private. Request to join or wait for an invite.",
              requestRequired: true,
              partyId: Number(party.party_id),
              publicName: String(party.public_name || "").trim(),
              ownerName: await getPartyOwnerName(partyId),
              capacity: { total: totalCap },
              memberCount: members.length,
              requestState: buildJoinRequestState(requestRow),
            },
          };
        }

        const [[{ cnt: currentCount }]] = await conn.query(
          "SELECT COUNT(*) AS cnt FROM party_members WHERE party_id = ? FOR UPDATE",
          [partyId],
        );
        if (currentCount >= totalCap) {
          await conn.rollback();
          return failure(409, { error: "Party is full", redirect: "/partyfull" });
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
          return failure(409, { error: "Party is full", redirect: "/partyfull" });
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
          joinedNow = true;
          if (invitedByFriend) consumePartyInvite(userId, partyId);
        } catch (e) {
          if (!(e && e.code === "ER_DUP_ENTRY")) {
            await conn.rollback();
            return failure(500, { error: "Could not join party" });
          }
        }
      }

      await conn.query(
        "UPDATE party_members SET last_seen = NOW() WHERE party_id = ? AND name = ?",
        [partyId, username],
      );

      await conn.commit();
      // Release the transaction's pool slot before issuing pooled reads/writes.
      conn.release();
      conn = null;
      try {
        await db.setUserStatus(username, "online");
      } catch (_) {}
      // Read once, after both presence updates. Detailed members retain the
      // joined_at/name order used to determine ownership (not seat order).
      const members = await db.fetchPartyMembersDetailed(partyId);
      return {
        ok: true,
        party,
        ownerName: members[0]?.name || null,
        selection: normalizeSelectionFromRow(party || {}),
        members,
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
    getPendingJoinRequests,
    submitJoinRequest,
    respondToJoinRequest,
    joinPartyAndGetData,
  };
}

module.exports = { createPartyStateService };
