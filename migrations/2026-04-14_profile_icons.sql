ALTER TABLE users
  ADD COLUMN selected_profile_icon_id VARCHAR(64) NULL;

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

CREATE INDEX idx_user_profile_icons_user_id ON user_profile_icons(user_id);
