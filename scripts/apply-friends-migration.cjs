require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'game', connectTimeout: 5000, multipleStatements: true });
  try {
    await conn.query('SET SESSION lock_wait_timeout=10');
    const [columns] = await conn.query("SHOW COLUMNS FROM users LIKE 'friend_code'");
    if (!columns.length) await conn.query('ALTER TABLE users ADD COLUMN friend_code VARCHAR(12) NULL, ADD UNIQUE KEY uq_users_friend_code (friend_code)');
    await conn.query(require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/2026-10-02_friends.sql'), 'utf8'));
    const [indexes] = await conn.query("SHOW INDEX FROM matches WHERE Key_name = 'idx_matches_created_at'");
    if (!indexes.length) await conn.query('ALTER TABLE matches ADD INDEX idx_matches_created_at (created_at)');
    console.log('Friends tables, users.friend_code and matches.created_at index verified.');
  } finally { await conn.end(); }
})().catch(error => { console.error('Friends migration failed:', error.code || error.message); process.exitCode = 1; });
