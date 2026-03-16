function computeUserMMRFromRow(user) {
  try {
    const levels = user?.char_levels ? JSON.parse(user.char_levels) : {};
    const vals = Object.values(levels).map((n) => Number(n) || 0);
    const unlocked = vals.filter((n) => n >= 1).length;
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return Math.round(avg * 100 + unlocked * 20);
  } catch (_) {
    return 0;
  }
}

async function computePartyMMR(db, partyId) {
  const rows = await db.runQuery(
    "SELECT u.user_id, u.char_levels FROM party_members pm JOIN users u ON u.name = pm.name WHERE pm.party_id = ?",
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
