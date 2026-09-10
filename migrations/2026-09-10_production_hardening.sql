-- Apply before deploying this version. Existing numeric identity cookies require login again.
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (token_hash),
  KEY idx_auth_sessions_user (user_id),
  KEY idx_auth_sessions_expiry (expires_at),
  CONSTRAINT fk_auth_sessions_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS match_reward_commits (
  match_id INT NOT NULL,
  summary JSON NOT NULL,
  committed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (match_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS shop_webhook_inbox (
  event_id VARCHAR(191) NOT NULL,
  payload JSON NOT NULL,
  next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_webhook_inbox_retry (next_attempt_at)
) ENGINE=InnoDB;
