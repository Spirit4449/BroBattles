ALTER TABLE users
  ADD COLUMN stripe_customer_id VARCHAR(191) NULL;

CREATE UNIQUE INDEX idx_users_stripe_customer_id
  ON users (stripe_customer_id);

CREATE TABLE IF NOT EXISTS shop_rotation_state (
  section VARCHAR(32) NOT NULL,
  period_key VARCHAR(64) NOT NULL,
  generation INT NOT NULL DEFAULT 0,
  refreshed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_refresh_at DATETIME NOT NULL,
  refreshed_by_user_id INT NULL,
  PRIMARY KEY (section)
);

CREATE TABLE IF NOT EXISTS shop_redemptions (
  redemption_id BIGINT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  offer_id VARCHAR(64) NOT NULL,
  limit_key VARCHAR(96) NOT NULL,
  redemption_kind ENUM('daily','virtual') NOT NULL,
  idempotency_key VARCHAR(96) NOT NULL,
  price_snapshot JSON NULL,
  reward_snapshot JSON NOT NULL,
  status ENUM('pending','fulfilled','failed') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fulfilled_at DATETIME NULL,
  PRIMARY KEY (redemption_id),
  UNIQUE KEY uniq_shop_redemption_limit (user_id, offer_id, limit_key),
  UNIQUE KEY uniq_shop_redemption_idempotency (user_id, idempotency_key),
  INDEX idx_shop_redemptions_user_created (user_id, created_at),
  CONSTRAINT fk_shop_redemptions_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shop_orders (
  order_id CHAR(36) NOT NULL,
  user_id INT NOT NULL,
  offer_id VARCHAR(64) NOT NULL,
  status ENUM('pending','paid','fulfilled','failed','expired','refunded','disputed') NOT NULL DEFAULT 'pending',
  amount_cents INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'usd',
  reward_snapshot JSON NOT NULL,
  idempotency_key VARCHAR(96) NOT NULL,
  stripe_checkout_session_id VARCHAR(191) NULL,
  stripe_payment_intent_id VARCHAR(191) NULL,
  refunded_amount_cents INT NOT NULL DEFAULT 0,
  reversed_coins INT NOT NULL DEFAULT 0,
  reversed_gems INT NOT NULL DEFAULT 0,
  dispute_status VARCHAR(32) NULL,
  last_error VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  fulfilled_at DATETIME NULL,
  PRIMARY KEY (order_id),
  UNIQUE KEY uniq_shop_order_idempotency (user_id, idempotency_key),
  UNIQUE KEY uniq_shop_order_session (stripe_checkout_session_id),
  INDEX idx_shop_orders_user_created (user_id, created_at),
  UNIQUE KEY uniq_shop_order_payment_intent (stripe_payment_intent_id),
  CONSTRAINT fk_shop_orders_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shop_webhook_events (
  event_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(96) NOT NULL,
  status ENUM('processing','processed','failed') NOT NULL DEFAULT 'processing',
  attempt_count INT NOT NULL DEFAULT 1,
  last_error VARCHAR(255) NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  PRIMARY KEY (event_id)
);

CREATE TABLE IF NOT EXISTS shop_currency_ledger (
  ledger_id BIGINT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  currency ENUM('coins','gems') NOT NULL,
  amount INT NOT NULL,
  source_type VARCHAR(48) NOT NULL,
  source_id VARCHAR(96) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ledger_id),
  UNIQUE KEY uniq_shop_ledger_source (source_type, source_id, currency),
  INDEX idx_shop_currency_ledger_user_created (user_id, created_at),
  CONSTRAINT fk_shop_currency_ledger_user
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
