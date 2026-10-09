const { getHighestWinStreak } = require('../../src/server/services/match/battleLog');

// Per-account transactions bound lock time and allow safe restart after failure.
async function backfillHighestWinStreak(conn) {
  let after = 0;
  while (true) {
    const [users] = await conn.query('SELECT user_id FROM users WHERE user_id > ? ORDER BY user_id LIMIT 100', [after]);
    if (!users.length) return;
    for (const user of users) {
      await conn.beginTransaction();
      try {
        const q = async (sql, params) => (await conn.query(sql, params))[0];
        const locked = await q('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [user.user_id]);
        if (locked.length) {
          const highest = await getHighestWinStreak({ runQuery: q }, user.user_id);
          await q('UPDATE users SET highest_win_streak = GREATEST(highest_win_streak, ?) WHERE user_id = ?', [highest, user.user_id]);
        }
        await conn.commit();
      } catch (error) {
        await conn.rollback();
        throw error;
      }
      after = user.user_id;
    }
  }
}
module.exports = { backfillHighestWinStreak };
