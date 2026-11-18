const { SOCKET_EVENTS } = require('../../../shared/net/socketEvents');

function listParticipants(query, matchId) {
  return query(`SELECT mp.user_id, mp.party_id, mp.team, u.name, u.socket_id
    FROM match_participants mp JOIN users u ON u.user_id = mp.user_id WHERE mp.match_id = ?`, [matchId]);
}

function idlePartiesForMatch(query, matchId) {
  return query("UPDATE parties p JOIN match_participants mp ON mp.party_id = p.party_id SET p.status = 'idle' WHERE mp.match_id = ?", [matchId]);
}

// The conditional write serializes abandonment against reward settlement and
// makes concurrent cancellations idempotent. Send event envelopes after commit.
async function cancelMatch(db, io, matchId, { reason, notify = 'none', liveOnly = false } = {}) {
  const cancel = async query => {
    const allowed = liveOnly ? "status = 'live'" : "status IN ('queued', 'live')";
    const changed = await query("UPDATE matches SET status = 'cancelled' WHERE match_id = ? AND " + allowed, [matchId]);
    if (changed.affectedRows === 0) return null;
    await idlePartiesForMatch(query, matchId);
    await query("UPDATE users u JOIN match_participants mp ON mp.user_id=u.user_id SET u.status='online' WHERE mp.match_id=? AND u.status='ready'", [matchId]);
    await query("DELETE FROM match_bot_participants WHERE match_id = ?", [matchId]);
    return notify === 'none' ? [] : listParticipants(query, matchId);
  };
  const participants = db.withTransaction
    ? await db.withTransaction((_conn, query) => cancel(query))
    : await cancel(db.runQuery.bind(db));
  if (!participants) return false;
  if (notify === 'sockets') {
    for (const { socket_id } of participants) io.sockets.sockets.get(socket_id)?.emit(SOCKET_EVENTS.MATCH_CANCELLED, { matchId, reason });
  } else if (notify === 'party') {
    const parties = new Set(participants.map(row => Number(row.party_id)).filter(id => id > 0));
    for (const partyId of parties) io.to('party:' + partyId).emit(SOCKET_EVENTS.MATCH_CANCELLED, { reason: reason || 'Match cancelled' });
  }
  return true;
}

async function cancelInterruptedMatches(db, pendingIds) {
  const exclusion = pendingIds.length ? ' AND match_id NOT IN (' + pendingIds.map(() => '?').join(',') + ')' : '';
  const rows = await db.runQuery("SELECT match_id FROM matches WHERE status = 'live'" + exclusion, pendingIds);
  for (const row of rows) await cancelMatch(db, null, row.match_id, { liveOnly: true });
}

// Old simulations without a room or pending journal have no result to settle.
async function retireInterruptedMatch(db, matchId) {
  return db.withTransaction(async (_conn, q) => {
    const changed = await q("UPDATE matches SET status='completed' WHERE match_id=? AND status='live'", [matchId]);
    if (!changed.affectedRows) return;
    await idlePartiesForMatch(q, matchId);
    await q("DELETE FROM match_bot_participants WHERE match_id = ?", [matchId]);
    await q("DELETE FROM match_participants WHERE match_id = ?", [matchId]);
  });
}

module.exports = { retireInterruptedMatch, listParticipants, idlePartiesForMatch, cancelMatch, cancelInterruptedMatches };
