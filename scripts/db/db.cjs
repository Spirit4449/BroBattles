// Shared MySQL helpers for migration/verification scripts. Add new additive
// migrations as steps in `scripts/db/apply-migration.cjs`.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

function connect(options = {}) {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'game',
    connectTimeout: 5000,
    ...options,
  });
}

async function hasTable(conn, table) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]);
  return rows.length > 0;
}

async function hasColumn(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]);
  return rows.length > 0;
}

async function hasIndex(conn, table, index) {
  const [rows] = await conn.query(
    'SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [table, index]);
  return rows.length > 0;
}

function readMigration(file) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
}

// Runs `fn(conn)` with a connection that is always closed, and reports
// failures through the exit code like the existing scripts.
function runScript(label, fn, options = { multipleStatements: true }) {
  (async () => {
    const conn = await connect(options);
    try {
      await conn.query('SET SESSION lock_wait_timeout = 10');
      await fn(conn);
    } finally {
      await conn.end();
    }
  })().catch((error) => {
    console.error(`${label} failed:`, error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { MIGRATIONS_DIR, connect, hasColumn, hasIndex, hasTable, readMigration, runScript };
