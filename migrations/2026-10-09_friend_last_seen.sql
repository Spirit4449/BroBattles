-- Apply with npm run migrate:apply -- friend-last-seen (safe to re-run).
-- Historical activity is unknown; do not invent timestamps for offline accounts.
SET @last_seen_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_seen_at'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMP NULL DEFAULT NULL'
);
PREPARE last_seen_stmt FROM @last_seen_ddl;
EXECUTE last_seen_stmt;
DEALLOCATE PREPARE last_seen_stmt;
