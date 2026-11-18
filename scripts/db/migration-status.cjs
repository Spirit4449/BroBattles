// Read-only schema verification, with migration-file hints for missing objects.
const fs = require('node:fs');
const { MIGRATIONS_DIR, connect, readMigration } = require('./db.cjs');
const { findSchemaProblems, readSchema } = require('../../src/server/core/schemaContract');

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

async function main() {
  const conn = await connect();
  try {
    const metadata = await readSchema({ runQuery: async sql => (await conn.query(sql))[0] });
    const problems = findSchemaProblems(metadata);
    const names = {
      table: new Set(metadata.columns.map(row => row.tableName)),
      column: new Set(metadata.columns.map(row => `${row.tableName}.${row.columnName}`)),
      index: new Set(metadata.keys.map(row => `${row.tableName}.${row.indexName}`)),
    };
    for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()) {
      const expected = expectedSchema(readMigration(file));
      const missing = expected.filter(item =>
        !names[item.kind].has(item.kind === 'table' ? item.table : `${item.table}.${item.name}`));
      const status = !expected.length ? 'data-only' : missing.length ? 'check DDL' : 'DDL found';
      console.log(`${status.padEnd(9)} ${file}${missing.length ? `\n          ${missing.map(describe).join(', ')}` : ''}`);
    }
    if (problems.length) {
      console.error(`\nDatabase schema problems:\n${problems.map(problem => `  ${problem}`).join('\n')}`);
      process.exitCode = 1;
    } else {
      console.log('\nDatabase satisfies the startup schema contract.');
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Migration status failed:', error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { expectedSchema };
