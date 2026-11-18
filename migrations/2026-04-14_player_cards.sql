SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'selected_card_id'),
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN selected_card_id VARCHAR(64) NULL'
);
PREPARE migration_stmt FROM @ddl;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

CREATE TABLE IF NOT EXISTS user_cards (
  `user_id` int NOT NULL,
  `card_id` varchar(64) NOT NULL,
  `acquired_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `source` varchar(32) NOT NULL DEFAULT 'grant',
  PRIMARY KEY (`user_id`,`card_id`),
  KEY `idx_user_cards_user_id` (`user_id`),
  CONSTRAINT `fk_user_cards_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
