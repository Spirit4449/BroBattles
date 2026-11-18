SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'selected_profile_icon_id'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN selected_profile_icon_id VARCHAR(64) NULL'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

CREATE TABLE IF NOT EXISTS user_profile_icons (
  user_id INT NOT NULL,
  icon_id VARCHAR(64) NOT NULL,
  unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(32) NOT NULL DEFAULT 'grant',
  PRIMARY KEY (user_id, icon_id),
  CONSTRAINT fk_user_profile_icons_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
);

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_profile_icons' AND INDEX_NAME = 'idx_user_profile_icons_user_id'),
  'SELECT 1',
  'CREATE INDEX idx_user_profile_icons_user_id ON user_profile_icons(user_id)'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
