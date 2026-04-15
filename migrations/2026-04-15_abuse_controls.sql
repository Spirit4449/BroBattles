ALTER TABLE users
  ADD COLUMN IF NOT EXISTS chat_offense_level INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chat_last_violation_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS chat_suspended_until DATETIME NULL,
  ADD COLUMN IF NOT EXISTS chat_decay_anchor_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS http_offense_level INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS http_last_violation_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS mm_suspended_until DATETIME NULL,
  ADD COLUMN IF NOT EXISTS http_decay_anchor_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS is_banned TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS banned_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS ban_reason VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS idx_users_chat_suspended_until
  ON users (chat_suspended_until);

CREATE INDEX IF NOT EXISTS idx_users_mm_suspended_until
  ON users (mm_suspended_until);

CREATE INDEX IF NOT EXISTS idx_users_is_banned
  ON users (is_banned);

CREATE TABLE IF NOT EXISTS user_abuse_events (
  event_id BIGINT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  category VARCHAR(40) NOT NULL,
  source VARCHAR(120) NOT NULL,
  action_taken VARCHAR(64) NOT NULL,
  offense_level INT NOT NULL DEFAULT 0,
  detail JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  INDEX idx_user_abuse_events_user_created (user_id, created_at),
  INDEX idx_user_abuse_events_category_created (category, created_at),
  CONSTRAINT fk_user_abuse_events_user
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE CASCADE
);
