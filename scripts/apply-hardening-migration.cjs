// Additive migration; existing accounts, balances, and matches are preserved.
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'game', multipleStatements: true });
  try {
    await conn.query('SET SESSION lock_wait_timeout = 10');
    for (const table of ['users', 'matches', 'match_participants', 'parties', 'shop_orders', 'shop_webhook_events']) {
      const [rows] = await conn.query('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]);
      if (rows[0]?.ENGINE !== 'InnoDB') throw new Error(`${table} must exist and use InnoDB before this migration`);
    }
    await conn.query(await fs.readFile(path.join(__dirname, '../migrations/2026-09-03_match_battle_log.sql'), 'utf8'));
    await conn.query(await fs.readFile(path.join(__dirname, '../migrations/2026-09-10_production_hardening.sql'), 'utf8'));
    const [rows] = await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('auth_sessions','match_reward_commits','shop_webhook_inbox') ORDER BY TABLE_NAME");
    if (rows.length !== 3) throw new Error('Migration table verification failed');
    console.log('Migration applied and verified: ' + rows.map(r => r.TABLE_NAME).join(', '));
  } finally { await conn.end(); }
})().catch(error => { console.error('Migration failed:', error.code || '', error.message); process.exitCode = 1; });
