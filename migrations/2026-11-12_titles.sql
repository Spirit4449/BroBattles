CREATE TABLE IF NOT EXISTS user_titles (
  user_id INT NOT NULL,
  title_id VARCHAR(64) NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'grant',
  unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, title_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

SET @title_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'selected_title_id'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN selected_title_id VARCHAR(64) NULL'
);
PREPARE title_stmt FROM @title_ddl;
EXECUTE title_stmt;
DEALLOCATE PREPARE title_stmt;
