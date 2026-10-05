const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedSchema } = require('../scripts/db/migration-status.cjs');

test('migration status derives additive DDL, including conditional PREPARE strings', () => {
  const sql = `
    -- ALTER TABLE ignored ADD COLUMN nope INT;
    CREATE TABLE IF NOT EXISTS \`friends\` (id INT);
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS friend_code VARCHAR(12) NULL,
      ADD UNIQUE KEY uq_users_friend_code (friend_code);
    SET @sql = IF(@missing, "ALTER TABLE parties ADD COLUMN mode_id VARCHAR(64) AFTER mode", 'SELECT 1');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_code ON users (friend_code);`;
  assert.deepEqual(expectedSchema(sql), [
    { kind: 'table', table: 'friends' },
    { kind: 'column', table: 'users', name: 'friend_code' },
    { kind: 'index', table: 'users', name: 'uq_users_friend_code' },
    { kind: 'column', table: 'parties', name: 'mode_id' },
    { kind: 'index', table: 'users', name: 'idx_users_code' },
  ]);
});
