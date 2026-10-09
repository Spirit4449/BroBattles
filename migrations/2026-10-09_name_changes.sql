-- Existing accounts may rename immediately; successful changes start a calendar-month cooldown.
SET @name_change_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'next_name_change_at'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN next_name_change_at DATETIME(3) NULL'
);
PREPARE name_change_stmt FROM @name_change_ddl;
EXECUTE name_change_stmt;
DEALLOCATE PREPARE name_change_stmt;
