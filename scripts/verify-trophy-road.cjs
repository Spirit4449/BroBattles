// Runs real MySQL grant SQL against a temporary user, then rolls everything back.
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const assert = require('node:assert/strict');
const { buildTrophyRewardTrack } = require('../src/server/helpers/trophySystem');
const { grantTrophyItems } = require('../src/server/helpers/trophyRewardGrants');
(async () => {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'game', connectTimeout: 5000 });
  const q = async (sql, params) => (await conn.query(sql, params))[0];
  try {
    await conn.beginTransaction();
    const inserted = await q("INSERT INTO users (name, char_class, status, expires_at, char_levels, trophies, trophy_peak) VALUES (?, 'ninja', 'offline', DATE_ADD(NOW(), INTERVAL 1 HOUR), ?, 2000, 10000)", [`TrophyQA${Date.now()}`, JSON.stringify({ninja:1,gloop:8})]);
    const id = inserted.insertId;
    const before = (await q('SELECT coins, gems, selected_card_id, selected_profile_icon_id FROM users WHERE user_id = ?', [id]))[0];
    const finale = buildTrophyRewardTrack().at(-1);
    await grantTrophyItems(q, id, finale.rewards);
    await grantTrophyItems(q, id, finale.rewards);
    await grantTrophyItems(q, id, [{kind:'character',itemId:'gloop'}]);
    assert.equal((await q('SELECT skin_id FROM user_skins WHERE user_id = ?', [id])).length, 2);
    assert.equal((await q('SELECT card_id FROM user_cards WHERE user_id = ?', [id])).length, 1);
    assert.equal((await q('SELECT icon_id FROM user_profile_icons WHERE user_id = ?', [id])).length, 2);
    const after = (await q('SELECT coins, gems, selected_card_id, selected_profile_icon_id, char_levels FROM users WHERE user_id = ?', [id]))[0];
    const levels = typeof after.char_levels === 'string' ? JSON.parse(after.char_levels) : after.char_levels;
    assert.equal(levels.gloop, 8);
    for (const key of Object.keys(before)) assert.equal(after[key], before[key]);
    const receiptSql = 'INSERT IGNORE INTO user_trophy_reward_claims (user_id, tier_id) VALUES (?, ?)';
    assert.equal((await q(receiptSql, [id, finale.tierId])).affectedRows, 1);
    assert.equal((await q(receiptSql, [id, finale.tierId])).affectedRows, 0);
    console.log('PASS: real MySQL cosmetic grants, idempotent ownership, duplicate claim receipt, preserved equipped loadout and Gloop level. All test writes rolled back.');
  } finally { await conn.rollback(); await conn.end(); }
})().catch(error => { console.error('Trophy verification failed:', error.code || error.message); process.exitCode = 1; });
