require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const { buildTrophyRewardTrack } = require('../src/server/helpers/trophySystem');
const { grantTrophyItems } = require('../src/server/helpers/trophyRewardGrants');
(async () => {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'game', connectTimeout: 5000, multipleStatements: true });
  try {
    await conn.query('SET SESSION lock_wait_timeout=10');
    const [columns] = await conn.query("SHOW COLUMNS FROM users LIKE 'trophy_peak'");
    if (!columns.length) await conn.query('ALTER TABLE users ADD COLUMN trophy_peak INT UNSIGNED NOT NULL DEFAULT 0');
    await conn.beginTransaction();
    await conn.query(require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/2026-09-15_trophy_road.sql'), 'utf8'));
    const q = async (sql, params) => (await conn.query(sql, params))[0];
    for (const tier of buildTrophyRewardTrack()) {
      if (!tier.rewards.some(r => !['currency', 'mode'].includes(r.kind))) continue;
      const rows = await q('SELECT user_id FROM user_trophy_reward_claims WHERE tier_id = ?', [tier.tierId]);
      for (const row of rows) {
        await q('SELECT user_id FROM users WHERE user_id = ? FOR UPDATE', [row.user_id]);
        await grantTrophyItems(q, row.user_id, tier.rewards.filter(r => r.kind !== 'currency'));
      }
    }
    await conn.commit();
    console.log('Trophy peak, legacy claims and cosmetic backfill verified. No currency reissued.');
  } catch (error) { await conn.rollback(); throw error; }
  finally { await conn.end(); }
})().catch(error => { console.error('Trophy migration failed:', error.code || error.message); process.exitCode = 1; });
