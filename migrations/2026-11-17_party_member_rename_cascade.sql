-- Renaming users.name must also rename their party membership without losing
-- the membership row. Locate the actual single-column foreign key by shape.
SET @party_name_fk = NULL, @party_name_delete = NULL, @party_name_update = NULL;
SELECT k.CONSTRAINT_NAME, r.DELETE_RULE, r.UPDATE_RULE
INTO @party_name_fk, @party_name_delete, @party_name_update
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
  AND r.TABLE_NAME = k.TABLE_NAME
  AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = 'party_members'
GROUP BY k.CONSTRAINT_NAME, r.DELETE_RULE, r.UPDATE_RULE
HAVING COUNT(*) = 1
  AND MAX(k.COLUMN_NAME) = 'name'
  AND MAX(k.REFERENCED_TABLE_SCHEMA) = DATABASE()
  AND MAX(k.REFERENCED_TABLE_NAME) = 'users'
  AND MAX(k.REFERENCED_COLUMN_NAME) = 'name';

-- The old constraint already validates the same columns. Disable the
-- redundant recheck in this session to replace it in one in-place ALTER.
SET @party_name_ddl = CASE
  WHEN @party_name_update = 'CASCADE' THEN 'SELECT 1'
  WHEN @party_name_fk IS NOT NULL THEN CONCAT(
    'ALTER TABLE party_members DROP FOREIGN KEY `', REPLACE(@party_name_fk, '`', '``'),
    '`, ADD CONSTRAINT fk_pm_user_name_cascade FOREIGN KEY (name) REFERENCES users (name)',
    ' ON DELETE ', @party_name_delete, ' ON UPDATE CASCADE, ALGORITHM=INPLACE, LOCK=SHARED'
  )
  ELSE 'SELECT missing_party_members_name_foreign_key'
END;
SET @previous_fk_checks = @@SESSION.foreign_key_checks;
SET SESSION foreign_key_checks = 0;
PREPARE party_name_stmt FROM @party_name_ddl;
EXECUTE party_name_stmt;
DEALLOCATE PREPARE party_name_stmt;
SET SESSION foreign_key_checks = @previous_fk_checks;
