CREATE TABLE IF NOT EXISTS shop_views (
  user_id INT NOT NULL,
  view_kind ENUM('offer', 'rotation') NOT NULL,
  view_key VARCHAR(128) NOT NULL,
  viewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, view_kind, view_key),
  CONSTRAINT fk_shop_views_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
