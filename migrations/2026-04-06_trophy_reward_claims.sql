CREATE TABLE IF NOT EXISTS user_trophy_reward_claims (
  user_id INT NOT NULL,
  tier_id VARCHAR(64) NOT NULL,
  claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tier_id),
  CONSTRAINT fk_user_trophy_reward_claims_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_user_trophy_reward_claims_user
  ON user_trophy_reward_claims(user_id);
