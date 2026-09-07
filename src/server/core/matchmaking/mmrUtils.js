function computeUserMMRFromRow(user) {
  return Math.max(0, Math.round(Number(user?.trophies) || 0));
}

async function computePartyMMR(db, partyId) {
  const rows = await db.runQuery(
    "SELECT u.user_id, u.trophies FROM party_members pm JOIN users u ON u.name = pm.name WHERE pm.party_id = ?",
    [partyId],
  );
  if (!rows.length) return 0;
  const mmrs = rows.map(computeUserMMRFromRow);
  return Math.round(mmrs.reduce((a, b) => a + b, 0) / mmrs.length);
}

async function getPartyTeamCounts(db, partyId) {
  const rows = await db.runQuery(
    "SELECT team, COUNT(*) AS c FROM party_members WHERE party_id = ? GROUP BY team",
    [partyId],
  );
  const t1 = rows.find((r) => r.team === "team1")?.c || 0;
  const t2 = rows.find((r) => r.team === "team2")?.c || 0;
  return { t1: Number(t1), t2: Number(t2) };
}

module.exports = {
  computeUserMMRFromRow,
  computePartyMMR,
  getPartyTeamCounts,
};

function ratingWindow(ticket, now = Date.now()) {
  const createdAt = new Date(ticket.created_at).getTime();
  const waitMs = Number.isFinite(createdAt) ? Math.max(0, now - createdAt) : 0;
  // Start close to the player's rating, reaching a 6,400 trophy range at 20s.
  // No trophy cap: distant ratings eventually become eligible too.
  return 100 * 2 ** (waitMs * 6 / 20000);
}
module.exports.ratingWindow = ratingWindow;
