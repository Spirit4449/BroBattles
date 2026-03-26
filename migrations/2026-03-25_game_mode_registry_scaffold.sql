SET @schema_name = DATABASE();

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name
        AND TABLE_NAME = 'parties'
        AND COLUMN_NAME = 'mode_id'
    ),
    'SELECT 1',
    "ALTER TABLE parties ADD COLUMN mode_id VARCHAR(64) NOT NULL DEFAULT 'duels' AFTER mode"
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name
        AND TABLE_NAME = 'parties'
        AND COLUMN_NAME = 'mode_variant_id'
    ),
    'SELECT 1',
    "ALTER TABLE parties ADD COLUMN mode_variant_id VARCHAR(64) NULL AFTER mode_id"
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name
        AND TABLE_NAME = 'matches'
        AND COLUMN_NAME = 'mode_id'
    ),
    'SELECT 1',
    "ALTER TABLE matches ADD COLUMN mode_id VARCHAR(64) NOT NULL DEFAULT 'duels' AFTER mode"
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name
        AND TABLE_NAME = 'matches'
        AND COLUMN_NAME = 'mode_variant_id'
    ),
    'SELECT 1',
    "ALTER TABLE matches ADD COLUMN mode_variant_id VARCHAR(64) NULL AFTER mode_id"
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name
        AND TABLE_NAME = 'match_tickets'
        AND COLUMN_NAME = 'mode_id'
    ),
    'SELECT 1',
    "ALTER TABLE match_tickets ADD COLUMN mode_id VARCHAR(64) NOT NULL DEFAULT 'duels' AFTER mode"
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema_name
        AND TABLE_NAME = 'match_tickets'
        AND COLUMN_NAME = 'mode_variant_id'
    ),
    'SELECT 1',
    "ALTER TABLE match_tickets ADD COLUMN mode_variant_id VARCHAR(64) NULL AFTER mode_id"
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE parties
SET mode_id = COALESCE(NULLIF(mode_id, ''), 'duels'),
    mode_variant_id = CASE COALESCE(mode, 1)
      WHEN 2 THEN 'duels-2v2'
      WHEN 3 THEN 'duels-3v3'
      ELSE 'duels-1v1'
    END
WHERE mode_id IS NULL
   OR mode_id = ''
   OR mode_variant_id IS NULL
   OR mode_variant_id = '';

UPDATE matches
SET mode_id = COALESCE(NULLIF(mode_id, ''), 'duels'),
    mode_variant_id = CASE COALESCE(mode, 1)
      WHEN 2 THEN 'duels-2v2'
      WHEN 3 THEN 'duels-3v3'
      ELSE 'duels-1v1'
    END
WHERE mode_id IS NULL
   OR mode_id = ''
   OR mode_variant_id IS NULL
   OR mode_variant_id = '';

UPDATE match_tickets
SET mode_id = COALESCE(NULLIF(mode_id, ''), 'duels'),
    mode_variant_id = CASE COALESCE(mode, 1)
      WHEN 2 THEN 'duels-2v2'
      WHEN 3 THEN 'duels-3v3'
      ELSE 'duels-1v1'
    END
WHERE mode_id IS NULL
   OR mode_id = ''
   OR mode_variant_id IS NULL
   OR mode_variant_id = '';

SET @sql = (
  SELECT IF(
    EXISTS(
      SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = @schema_name
        AND TABLE_NAME = 'match_tickets'
        AND INDEX_NAME = 'idx_match_tickets_queue_bucket'
    ),
    'SELECT 1',
    'CREATE INDEX idx_match_tickets_queue_bucket ON match_tickets (status, mode_id, mode_variant_id, map, created_at)'
  )
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
