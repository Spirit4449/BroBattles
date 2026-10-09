-- Apply with npm run migrate:apply -- highest-win-streak to backfill history.
SET @highest_streak_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'highest_win_streak'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN highest_win_streak INT UNSIGNED NOT NULL DEFAULT 0'
);
PREPARE highest_streak_stmt FROM @highest_streak_ddl;
EXECUTE highest_streak_stmt;
DEALLOCATE PREPARE highest_streak_stmt;
