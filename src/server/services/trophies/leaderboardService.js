const { createTtlCache } = require("../../lib/ttlCache");
const { resolveCharacterKey } = require("../../../shared/characters/characterStats");

const LEADERBOARD_MAX_PLAYERS = 200;

function createLeaderboardService(db) {
  const top = createTtlCache({ ttlMs: 20000, maxEntries: 1 });
  return async function getLeaderboard(limit) {
    const ranking = await top("trophies", async () => {
      const rows = await db.runQuery(
        `SELECT ranked.*, (
           SELECT COUNT(*) FROM match_participants mp
           JOIN matches m ON m.match_id = mp.match_id
           WHERE mp.user_id = ranked.user_id AND m.status = 'completed' AND m.winner_team = mp.team
         ) AS wins
         FROM (SELECT user_id, name AS username, char_class AS charClass,
                      selected_profile_icon_id AS profileIconId, selected_title_id AS selectedTitleId, COALESCE(trophies, 0) AS trophies, updated_at
                 FROM users WHERE name NOT LIKE 'BOT %'
                 ORDER BY trophies DESC, updated_at DESC, name ASC LIMIT ${LEADERBOARD_MAX_PLAYERS}) ranked
         ORDER BY trophies DESC, updated_at DESC, username ASC`);
      return rows.map((row, index) => ({
        rank: index + 1, username: row.username, charClass: resolveCharacterKey(row.charClass),
        profileIconId: row.profileIconId || null, selectedTitleId: row.selectedTitleId || null,
        trophies: Number(row.trophies) || 0, wins: Number(row.wins) || 0,
      }));
    });
    return ranking.slice(0, limit);
  };
}
module.exports = { createLeaderboardService, LEADERBOARD_MAX_PLAYERS };
