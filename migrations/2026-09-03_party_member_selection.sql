-- Preserve existing member map/mode access; owners can turn it off in settings.
SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parties' AND COLUMN_NAME = 'allow_member_selection'),
  'SELECT 1',
  'ALTER TABLE parties ADD COLUMN allow_member_selection TINYINT(1) NOT NULL DEFAULT 1'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
