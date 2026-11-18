-- Party discovery + visibility settings
-- Adds public/private controls and a public party name.

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parties' AND COLUMN_NAME = 'is_public'),
  'SELECT 1',
  'ALTER TABLE parties ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parties' AND COLUMN_NAME = 'public_name'),
  'SELECT 1',
  'ALTER TABLE parties ADD COLUMN public_name VARCHAR(32) NULL'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parties' AND INDEX_NAME = 'idx_parties_is_public'),
  'SELECT 1',
  'CREATE INDEX idx_parties_is_public ON parties (is_public)'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parties' AND INDEX_NAME = 'idx_parties_public_name'),
  'SELECT 1',
  'CREATE INDEX idx_parties_public_name ON parties (public_name)'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
