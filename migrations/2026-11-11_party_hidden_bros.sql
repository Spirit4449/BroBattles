-- Keep existing party portraits visible unless the owner opts in.
SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parties' AND COLUMN_NAME = 'hide_enemy_bros'),
  'SELECT 1',
  'ALTER TABLE parties ADD COLUMN hide_enemy_bros TINYINT(1) NOT NULL DEFAULT 0'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
