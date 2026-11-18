const schemaRequirements = require("./schemaRequirements");

async function readSchema(db) {
  const columns = await db.runQuery(`
      SELECT t.TABLE_NAME AS tableName, t.ENGINE AS engine, c.COLUMN_NAME AS columnName
      FROM information_schema.TABLES t
      JOIN information_schema.COLUMNS c
        ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
      WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'`);
  const keys = await db.runQuery(`
      SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName,
             NON_UNIQUE AS nonUnique, SUB_PART AS prefixLength
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND IS_VISIBLE = 'YES'
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`);
  const foreignKeys = await db.runQuery(`
      SELECT k.TABLE_NAME AS tableName, k.CONSTRAINT_NAME AS constraintName, k.COLUMN_NAME AS columnName,
             k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn,
             r.UPDATE_RULE AS updateRule, r.DELETE_RULE AS deleteRule
      FROM information_schema.KEY_COLUMN_USAGE k
      JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_SCHEMA = DATABASE()
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`);
  const checks = await db.runQuery(`
      SELECT t.TABLE_NAME AS tableName, c.CHECK_CLAUSE AS clause
      FROM information_schema.TABLE_CONSTRAINTS t
      JOIN information_schema.CHECK_CONSTRAINTS c
        ON c.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME = t.CONSTRAINT_NAME
      WHERE t.TABLE_SCHEMA = DATABASE() AND t.ENFORCED = 'YES'`);
  return { columns, keys, foreignKeys, checks };
}

function groupBy(rows, getKey) {
  const groups = new Map();
  for (const row of rows) {
    const name = getKey(row);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return groups;
}

function keyDefinition(rows) {
  const [first] = rows;
  const kind = first.indexName === "PRIMARY" ? "PRIMARY" : Number(first.nonUnique) ? "INDEX" : "UNIQUE";
  const columns = rows.map(row => row.prefixLength ? `${row.columnName}(${row.prefixLength})` : row.columnName);
  return `${kind} (${columns.join(", ")})`;
}

function foreignKeyDefinition(rows) {
  const [first] = rows;
  const columns = rows.map(row => row.columnName).join(", ");
  const referencedColumns = rows.map(row => row.referencedColumn).join(", ");
  const normalizedRule = rule => rule === "NO ACTION" ? "RESTRICT" : rule;
  const prefix = `(${columns}) REFERENCES ${first.referencedTable} (${referencedColumns})`;
  const deleteRule = `ON DELETE ${normalizedRule(first.deleteRule)}`;
  const updateRule = normalizedRule(first.updateRule);
  return updateRule === "RESTRICT" ? `${prefix} ${deleteRule}` : `${prefix} ${deleteRule} ON UPDATE ${updateRule}`;
}

function checkDefinition(clause) {
  return clause.toLowerCase().replace(/[`\s]/g, "");
}

function findSchemaProblems({ columns, keys, foreignKeys, checks }, requirements = schemaRequirements) {
  const tables = groupBy(columns, row => row.tableName);
  const indexes = groupBy(keys, row => row.tableName);
  const references = groupBy(foreignKeys, row => row.tableName);
  const constraints = groupBy(checks, row => row.tableName);
  const problems = [];

  for (const [table, expected] of Object.entries(requirements)) {
    const tableColumns = tables.get(table);
    if (!tableColumns?.length) {
      problems.push(`Missing table ${table}`);
      continue;
    }
    if (tableColumns[0].engine !== "InnoDB") problems.push(`${table} must use InnoDB`);

    const names = new Set(tableColumns.map(row => row.columnName));
    for (const column of expected.columns.split(" ")) {
      if (!names.has(column)) problems.push(`Missing column ${table}.${column}`);
    }
    const keyRows = groupBy(indexes.get(table) || [], row => row.indexName);
    const definitions = new Set([...keyRows.values()].map(keyDefinition));
    for (const key of expected.keys || []) {
      if (!definitions.has(key)) problems.push(`Missing index on ${table} ${key}`);
    }
    const referenceRows = groupBy(references.get(table) || [], row => row.constraintName);
    const referenceDefinitions = new Set([...referenceRows.values()].map(foreignKeyDefinition));
    for (const foreignKey of expected.foreignKeys || []) {
      if (!referenceDefinitions.has(foreignKey)) problems.push(`Missing foreign key on ${table} ${foreignKey}`);
    }
    const clauses = new Set((constraints.get(table) || []).map(row => checkDefinition(row.clause)));
    for (const check of expected.checks || []) {
      if (!clauses.has(checkDefinition(check))) problems.push(`Missing check on ${table} ${check}`);
    }
  }
  return problems;
}

async function assertSchema(db) {
  const problems = findSchemaProblems(await readSchema(db));
  if (problems.length) {
    throw new Error(`Database schema is incomplete. Run npm run migrate:status for migration details.\n${problems.join("\n")}`);
  }
}

module.exports = { assertSchema, findSchemaProblems, readSchema };
