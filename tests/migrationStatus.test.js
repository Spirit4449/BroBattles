const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedSchema } = require('../scripts/db/migration-status.cjs');
const { findSchemaProblems } = require('../src/server/core/schemaContract');

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

test('schema verification rejects missing columns and incompatible database keys', () => {
  const requirements = {
    orders: {
      columns: 'id user_id intent_id',
      keys: ['PRIMARY (id)', 'UNIQUE (intent_id)'],
      foreignKeys: ['(user_id) REFERENCES users (id) ON DELETE CASCADE'],
    },
  };
  const columns = ['id', 'intent_id'].map(columnName => ({ tableName: 'orders', engine: 'InnoDB', columnName }));
  const keys = [
    { tableName: 'orders', indexName: 'PRIMARY', columnName: 'id', nonUnique: 0 },
    { tableName: 'orders', indexName: 'idx_intent_id', columnName: 'intent_id', nonUnique: 1 },
  ];
  const foreignKeys = [{
    tableName: 'orders',
    constraintName: 'fk_user',
    columnName: 'user_id',
    referencedTable: 'users',
    referencedColumn: 'id',
    updateRule: 'NO ACTION',
    deleteRule: 'SET NULL',
  }];
  const schema = { columns, keys, foreignKeys, checks: [] };
  assert.deepEqual(findSchemaProblems(schema, requirements), [
    'Missing column orders.user_id',
    'Missing index on orders UNIQUE (intent_id)',
    'Missing foreign key on orders (user_id) REFERENCES users (id) ON DELETE CASCADE',
  ]);

  columns.push({ tableName: 'orders', engine: 'InnoDB', columnName: 'user_id' });
  keys[1] = { ...keys[1], nonUnique: 0, prefixLength: 8 };
  foreignKeys[0] = { ...foreignKeys[0], deleteRule: 'CASCADE' };
  assert.deepEqual(findSchemaProblems(schema, requirements), ['Missing index on orders UNIQUE (intent_id)']);

  keys[1] = { ...keys[1], prefixLength: null };
  assert.deepEqual(findSchemaProblems(schema, requirements), []);
});


test('the startup schema contract requires party membership to follow account renames', () => {
  const { party_members } = require('../src/server/core/schemaRequirements');
  const columns = party_members.columns.split(' ').map(columnName => ({
    tableName: 'party_members', engine: 'InnoDB', columnName,
  }));
  const foreignKeys = [
    { tableName: 'party_members', constraintName: 'fk_party', columnName: 'party_id',
      referencedTable: 'parties', referencedColumn: 'party_id', updateRule: 'RESTRICT', deleteRule: 'CASCADE' },
    { tableName: 'party_members', constraintName: 'fk_name', columnName: 'name',
      referencedTable: 'users', referencedColumn: 'name', updateRule: 'RESTRICT', deleteRule: 'CASCADE' },
  ];
  const schema = { columns, foreignKeys, keys: [], checks: [] };
  const requirements = { party_members: { ...party_members, keys: [] } };
  assert.deepEqual(findSchemaProblems(schema, requirements), [
    'Missing foreign key on party_members (name) REFERENCES users (name) ON DELETE CASCADE ON UPDATE CASCADE',
  ]);
  foreignKeys[1].updateRule = 'CASCADE';
  assert.deepEqual(findSchemaProblems(schema, requirements), []);
});
