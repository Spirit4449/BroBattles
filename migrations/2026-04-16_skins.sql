ALTER TABLE users
  ADD COLUMN selected_skin_id_by_char JSON NULL;

CREATE TABLE IF NOT EXISTS user_skins (
  user_id INT NOT NULL,
  skin_id VARCHAR(64) NOT NULL,
  acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(32) DEFAULT 'grant',
  PRIMARY KEY (user_id, skin_id),
  CONSTRAINT fk_user_skins_user_id
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_user_skins_user_id ON user_skins (user_id);
