// Read-only report of which migrations/*.sql files appear unapplied. Expected
// tables, columns and indexes are derived from each file's additive DDL
// (including DDL embedded in conditional PREPARE strings), so new migrations
// are covered without registering them. Changes made only inside an apply
// script, or destructive statements, are not detected.
const fs = require('node:fs');
const { MIGRATIONS_DIR, connect, hasColumn, hasIndex, hasTable } = require('./lib/db.cjs');

const NAME = '`?(\\w+)`?';

function expectedSchema(sql) {
  const text = sql.replace(/--[^\n]*/g, '');
  const expected = [];
  for (const [, table] of text.matchAll(new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?${NAME}`, 'gi'))) {
    expected.push({ kind: 'table', table });
  }
  // An ALTER body ends at the statement or at the end of its quoted string.
  for (const [, table, body] of text.matchAll(new RegExp(`ALTER TABLE ${NAME}([^;"']*)`, 'gi'))) {
    for (const [, column] of body.matchAll(new RegExp(`ADD COLUMN (?:IF NOT EXISTS )?${NAME}`, 'gi'))) {
      expected.push({ kind: 'column', table, name: column });
    }
    for (const [, index] of body.matchAll(new RegExp(`ADD (?:UNIQUE )?(?:KEY|INDEX) (?:IF NOT EXISTS )?${NAME}`, 'gi'))) {
      expected.push({ kind: 'index', table, name: index });
    }
  }
  for (const [, index, table] of text.matchAll(
    new RegExp(`CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?${NAME}\\s+ON\\s+${NAME}`, 'gi'))) {
    expected.push({ kind: 'index', table, name: index });
  }
  return expected;
}

const describe = (item) => item.kind === 'table' ? `table ${item.table}` : `${item.kind} ${item.table}.${item.name}`;

async function isPresent(conn, item) {
  if (item.kind === 'table') return hasTable(conn, item.table);
  if (item.kind === 'column') return hasColumn(conn, item.table, item.name);
  return hasIndex(conn, item.table, item.name);
}

async function main() {
  const conn = await connect();
  let pending = 0;
  try {
    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()) {
      const expected = expectedSchema(fs.readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8'));
      const missing = [];
      for (const item of expected) if (!(await isPresent(conn, item))) missing.push(describe(item));
      if (missing.length) pending++;
      const status = !expected.length ? 'unchecked' : missing.length ? 'MISSING' : 'applied';
      console.log(`${status.padEnd(9)} ${file}${missing.length ? `\n          ${missing.join(', ')}` : ''}`);
    }
  } finally {
    await conn.end();
  }
  if (pending) {
    console.log(`\n${pending} migration(s) look unapplied. Run the matching scripts/apply-*-migration.cjs or the SQL file.`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Migration status failed:', error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { expectedSchema };
