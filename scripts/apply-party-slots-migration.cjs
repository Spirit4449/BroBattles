require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'game', connectTimeout: 5000 });
  try {
    await conn.query('SET SESSION lock_wait_timeout=10');
    const [rows] = await conn.query("SHOW COLUMNS FROM party_members LIKE 'slot_index'");
    if (!rows.length) await conn.query(require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/2026-09-14_party_slots.sql'), 'utf8'));
    console.log('Party slot column verified.');
  } finally { await conn.end(); }
})().catch(error => { console.error('Party slot migration failed:', error.code || error.message); process.exitCode = 1; });
