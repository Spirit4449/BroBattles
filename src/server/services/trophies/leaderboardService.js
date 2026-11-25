const { createTtlCache } = require("../../lib/ttlCache");
const { resolveCharacterKey } = require("../../../shared/characters/characterStats");

const LEADERBOARD_MAX_PLAYERS = 200;
const PUBLIC_STANDINGS_LIMIT = 50;
const order = "COALESCE(trophies, 0) DESC, updated_at DESC, name ASC";
const fields = `user_id, name AS username, char_class AS charClass, selected_profile_icon_id AS profileIconId,
                selected_title_id AS selectedTitleId, COALESCE(trophies, 0) AS trophies`;
const eligible = "FROM users WHERE name NOT LIKE 'BOT %'";
const wins = `(SELECT COUNT(*) FROM match_participants mp JOIN matches m ON m.match_id = mp.match_id
               WHERE mp.user_id = ranked.user_id AND m.status = 'completed' AND m.winner_team = mp.team) AS wins`;

function standing(row, rank) {
  return {
    rank, username: row.username, charClass: resolveCharacterKey(row.charClass),
    profileIconId: row.profileIconId || null, selectedTitleId: row.selectedTitleId || null,
    trophies: Number(row.trophies) || 0, wins: Number(row.wins) || 0,
  };
}

async function findLeaderboardPlayer(db, username) {
  if (username.length > 50) return [];
  const rows = await db.runQuery(
    `SELECT ranked.*, ${wins} FROM (
       SELECT ${fields}, ROW_NUMBER() OVER (ORDER BY ${order}) AS position_number ${eligible}
     ) ranked WHERE username = ?`, [username],
  );
  return rows.map(row => standing(row, Number(row.position_number)));
}

function createLeaderboardService(db) {
  const top = createTtlCache({ ttlMs: 20000, maxEntries: 1 });
  return async function getLeaderboard(limit) {
    const ranking = await top("trophies", async () => {
      const rows = await db.runQuery(
        `SELECT ranked.*, ${wins} FROM (
           SELECT ${fields}, updated_at ${eligible} ORDER BY ${order} LIMIT ${LEADERBOARD_MAX_PLAYERS}
         ) ranked ORDER BY trophies DESC, updated_at DESC, username ASC`,
      );
      return rows.map((row, index) => standing(row, index + 1));
    });
    return ranking.slice(0, limit);
  };
}
module.exports = { createLeaderboardService, findLeaderboardPlayer, PUBLIC_STANDINGS_LIMIT, LEADERBOARD_MAX_PLAYERS };
