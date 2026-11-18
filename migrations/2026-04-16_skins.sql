SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'selected_skin_id_by_char'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN selected_skin_id_by_char JSON NULL'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

CREATE TABLE IF NOT EXISTS user_skins (
  user_id INT NOT NULL,
  skin_id VARCHAR(64) NOT NULL,
  acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(32) DEFAULT 'grant',
  PRIMARY KEY (user_id, skin_id),
  CONSTRAINT fk_user_skins_user_id
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_skins' AND INDEX_NAME = 'idx_user_skins_user_id'),
  'SELECT 1',
  'CREATE INDEX idx_user_skins_user_id ON user_skins (user_id)'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
