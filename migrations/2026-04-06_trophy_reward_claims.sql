CREATE TABLE IF NOT EXISTS user_trophy_reward_claims (
  user_id INT NOT NULL,
  tier_id VARCHAR(64) NOT NULL,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tier_id),
  CONSTRAINT fk_user_trophy_reward_claims_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
);

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_trophy_reward_claims' AND INDEX_NAME = 'idx_user_trophy_reward_claims_user'),
  'SELECT 1',
  'CREATE INDEX idx_user_trophy_reward_claims_user ON user_trophy_reward_claims(user_id)'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
