function createQueueTicketManager({
  db,
  partyStatus,
  teamSizeForMode,
  computeUserMMRFromRow,
  computePartyMMR,
  getPartyTeamCounts,
  lastProgress,
  ensureLoop,
  maybeStopLoop,
}) {
  async function queueJoin({
    partyId = null,
    userId = null,
    mode,
    map,
    side = null,
  }) {
    const S = teamSizeForMode(mode);
    let counts = { t1: 0, t2: 0 };
    let size = 0;
    let mmr = 0;

    if (partyId) {
      counts = await getPartyTeamCounts(db, partyId);
      if (counts.t1 > S || counts.t2 > S) {
        throw new Error("team overflow for mode");
      }
      size = counts.t1 + counts.t2;
      const rows = await db.runQuery(
        "SELECT 1 FROM party_members WHERE party_id=? LIMIT 1",
        [partyId],
      );
      if (!rows.length) throw new Error("empty party");
      if (size <= 0) throw new Error("no players assigned to teams");
      mmr = await computePartyMMR(db, partyId);
    } else {
      if (side !== "team1" && side !== "team2") {
        counts = { t1: 1, t2: 0 };
      } else {
        counts = side === "team1" ? { t1: 1, t2: 0 } : { t1: 0, t2: 1 };
      }
      size = 1;
      const u = await db.getUserById(userId);
      if (!u) throw new Error("user not found");
      mmr = computeUserMMRFromRow(u);
    }

    const res = await db.runQuery(
      "INSERT INTO match_tickets (party_id,user_id,mode,map,size,mmr,team1_count,team2_count) VALUES (?,?,?,?,?,?,?,?) " +
        "ON DUPLICATE KEY UPDATE mode=VALUES(mode), map=VALUES(map), size=VALUES(size), mmr=VALUES(mmr), team1_count=VALUES(team1_count), team2_count=VALUES(team2_count), status='queued', claimed_by=NULL",
      [
        partyId || null,
        userId || null,
        Number(mode),
        Number(map),
        Number(size),
        Number(mmr),
        counts.t1,
        counts.t2,
      ],
    );

    if (partyId) {
      await db.runQuery("UPDATE parties SET status=? WHERE party_id=?", [
        partyStatus.QUEUED,
        partyId,
      ]);
    }

    console.log(
      `[queue] join ${partyId ? "p=" + partyId : "u=" + userId} mode=${mode} map=${map} t1=${counts.t1} t2=${counts.t2} mmr=${mmr}`,
    );

    lastProgress.clear();
    await ensureLoop();
    return res.insertId || 0;
  }

  async function queueLeave({ partyId = null, userId = null }) {
    const field = partyId ? "party_id" : "user_id";
    const id = partyId || userId;
    const r = await db.runQuery(
      `DELETE FROM match_tickets WHERE ${field} = ?`,
      [id],
    );
    if (partyId) {
      await db.runQuery("UPDATE parties SET status=? WHERE party_id=?", [
        partyStatus.IDLE,
        partyId,
      ]);
    }
    console.log(
      `[queue] leave ${partyId ? "p=" + partyId : "u=" + userId} removed=${r?.affectedRows || 0}`,
    );
    lastProgress.clear();
    await maybeStopLoop();
  }

  async function handleDisconnect(name) {
    const rows = await db.runQuery(
      "SELECT party_id FROM party_members WHERE name=? LIMIT 1",
      [name],
    );
    const partyId = rows[0]?.party_id || null;
    if (partyId) {
      await db.runQuery("DELETE FROM match_tickets WHERE party_id=?", [
        partyId,
      ]);
      console.log(`[queue] remove p=${partyId} reason=disconnect name=${name}`);
      await maybeStopLoop();
    }

    try {
      const u = await db.runQuery(
        "SELECT user_id FROM users WHERE name=? LIMIT 1",
        [name],
      );
      const userId = u[0]?.user_id || null;
      if (userId) {
        const r = await db.runQuery(
          "DELETE FROM match_tickets WHERE user_id=?",
          [userId],
        );
        if (r?.affectedRows) {
          console.log(
            `[queue] remove u=${userId} reason=disconnect name=${name}`,
          );
          await maybeStopLoop();
        }
      }
    } catch (_) {}
  }

  async function invalidatePartyTicket(partyId) {
    await db.runQuery("DELETE FROM match_tickets WHERE party_id=?", [partyId]);
    console.log(`[queue] invalidate p=${partyId} reason=team-change`);
    await maybeStopLoop();
  }

  return {
    queueJoin,
    queueLeave,
    handleDisconnect,
    invalidatePartyTicket,
  };
}

module.exports = { createQueueTicketManager };
