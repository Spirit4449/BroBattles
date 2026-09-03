-- Idempotent on MySQL, including databases with some result columns already added.
-- NULL preserves the distinction between missing history and a recorded zero.
SET @battle_log_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matches' AND COLUMN_NAME = 'winner_team'),
  'SELECT 1',
  'ALTER TABLE matches ADD COLUMN winner_team VARCHAR(16) NULL DEFAULT NULL'
);
PREPARE battle_log_stmt FROM @battle_log_ddl;
EXECUTE battle_log_stmt;
DEALLOCATE PREPARE battle_log_stmt;

SET @battle_log_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'matches' AND COLUMN_NAME = 'summary'),
  'SELECT 1',
  'ALTER TABLE matches ADD COLUMN summary JSON NULL'
);
PREPARE battle_log_stmt FROM @battle_log_ddl;
EXECUTE battle_log_stmt;
DEALLOCATE PREPARE battle_log_stmt;

SET @battle_log_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_participants' AND COLUMN_NAME = 'trophies_delta'),
  'SELECT 1',
  'ALTER TABLE match_participants ADD COLUMN trophies_delta INT NULL DEFAULT NULL'
);
PREPARE battle_log_stmt FROM @battle_log_ddl;
EXECUTE battle_log_stmt;
DEALLOCATE PREPARE battle_log_stmt;

SET @battle_log_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_participants' AND COLUMN_NAME = 'kills'),
  'SELECT 1',
  'ALTER TABLE match_participants ADD COLUMN kills INT NULL DEFAULT NULL'
);
PREPARE battle_log_stmt FROM @battle_log_ddl;
EXECUTE battle_log_stmt;
DEALLOCATE PREPARE battle_log_stmt;

SET @battle_log_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_participants' AND COLUMN_NAME = 'damage'),
  'SELECT 1',
  'ALTER TABLE match_participants ADD COLUMN damage INT NULL DEFAULT NULL'
);
PREPARE battle_log_stmt FROM @battle_log_ddl;
EXECUTE battle_log_stmt;
DEALLOCATE PREPARE battle_log_stmt;

SET @battle_log_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_participants' AND COLUMN_NAME = 'hits'),
  'SELECT 1',
  'ALTER TABLE match_participants ADD COLUMN hits INT NULL DEFAULT NULL'
);
PREPARE battle_log_stmt FROM @battle_log_ddl;
EXECUTE battle_log_stmt;
DEALLOCATE PREPARE battle_log_stmt;

SET @battle_log_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_participants' AND COLUMN_NAME = 'coins_awarded'),
  'SELECT 1',
  'ALTER TABLE match_participants ADD COLUMN coins_awarded INT NULL DEFAULT NULL'
);
PREPARE battle_log_stmt FROM @battle_log_ddl;
EXECUTE battle_log_stmt;
DEALLOCATE PREPARE battle_log_stmt;

SET @battle_log_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'match_participants' AND COLUMN_NAME = 'gems_awarded'),
  'SELECT 1',
  'ALTER TABLE match_participants ADD COLUMN gems_awarded INT NULL DEFAULT NULL'
);
PREPARE battle_log_stmt FROM @battle_log_ddl;
EXECUTE battle_log_stmt;
DEALLOCATE PREPARE battle_log_stmt;
