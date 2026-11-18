SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'party_members' AND COLUMN_NAME = 'slot_index'),
  'SELECT 1',
  'ALTER TABLE party_members ADD COLUMN slot_index TINYINT UNSIGNED NULL DEFAULT NULL'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
