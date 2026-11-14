const { canonicalCharacterKey, getAllCharacters } = require("../../../shared/characters/characterStats.js");

async function getFavoriteCharacter(db, userId) {
  const rows = await db.runQuery(
    `SELECT mp.char_class, COUNT(*) AS matchesPlayed
       FROM match_participants mp
       JOIN matches m ON m.match_id = mp.match_id
      WHERE mp.user_id = ? AND m.status = 'completed'
      GROUP BY mp.char_class`,
    [userId],
  );
  const valid = new Set(getAllCharacters());
  const counts = new Map();
  for (const row of rows) {
    const character = canonicalCharacterKey(row.char_class);
    const count = Number(row.matchesPlayed) || 0;
    if (valid.has(character) && count > 0) {
      counts.set(character, (counts.get(character) || 0) + count);
    }
  }
  const favorites = [...counts].map(([character, matchesPlayed]) => ({ character, matchesPlayed }));
  favorites.sort((a, b) => b.matchesPlayed - a.matchesPlayed || a.character.localeCompare(b.character));
  return favorites[0] || null;
}

module.exports = { getFavoriteCharacter };
