const { getModeUnlockReason, getModeUnlockRequirement } = require("../../shared/trophyProgression");
async function assertModeAccess(db, modeId, { partyId, userId, actorName }) {
  if (!getModeUnlockRequirement(modeId)) return;
  const rows = actorName
    ? await db.runQuery("SELECT name, trophies, trophy_peak FROM users WHERE name = ?", [actorName])
    : partyId
    ? await db.runQuery("SELECT u.name, u.trophies, u.trophy_peak FROM party_members pm JOIN users u ON u.name = pm.name WHERE pm.party_id = ? ORDER BY pm.joined_at ASC, pm.name ASC LIMIT 1", [partyId])
    : await db.runQuery("SELECT name, trophies, trophy_peak FROM users WHERE user_id = ?", [userId]);
  if (!rows.length) throw new Error("Player not found");
  for (const row of rows) {
    const reason = getModeUnlockReason(modeId, row);
    if (reason) throw new Error(`${row.name}: ${reason}`);
  }
}
module.exports = { assertModeAccess };
