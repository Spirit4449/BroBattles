-- Additive: no age or birthdate data is collected.
CREATE TABLE IF NOT EXISTS legal_acceptances (
  user_id INT NOT NULL,
  terms_version VARCHAR(32) NOT NULL,
  privacy_version VARCHAR(32) NOT NULL,
  context VARCHAR(16) NOT NULL,
  accepted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, terms_version, privacy_version, context)
);
CREATE TABLE IF NOT EXISTS site_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  kind ENUM('feedback','support') NOT NULL,
  category VARCHAR(32) NOT NULL,
  subject VARCHAR(120) NOT NULL,
  status ENUM('open','in_progress','closed') NOT NULL DEFAULT 'open',
  version VARCHAR(32) NOT NULL,
  submission_key VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at DATETIME(3) NULL,
  player_read_at DATETIME(3) NULL,
  admin_read_at DATETIME(3) NULL,
  UNIQUE KEY site_submission (user_id, submission_key),
  KEY site_owner (user_id, kind, updated_at),
  KEY site_inbox (kind, status, updated_at)
);
CREATE TABLE IF NOT EXISTS site_request_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  sender ENUM('player','admin') NOT NULL,
  author_id INT NOT NULL,
  body TEXT NOT NULL,
  submission_key VARCHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY site_message_submission (request_id, sender, submission_key),
  CONSTRAINT site_message_request FOREIGN KEY (request_id) REFERENCES site_requests(id) ON DELETE CASCADE
);
