-- Pending signup never changes the live guest account or its authentication cookie.
CREATE TABLE IF NOT EXISTS pending_signups (
 user_id INT PRIMARY KEY,
 challenge_id CHAR(36) NULL,
 username VARCHAR(14) NULL,
 password_hash VARCHAR(255) NULL,
 email VARCHAR(254) NULL,
 code_hash CHAR(64) NULL,
 expires_at DATETIME(3) NULL,
 attempts INT NOT NULL DEFAULT 0,
 sent_at DATETIME(3) NULL,
 window_start DATETIME(3) NULL,
 send_count INT NOT NULL DEFAULT 0,
 correction_used BOOLEAN NOT NULL DEFAULT FALSE,
 marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
 terms_version VARCHAR(32) NULL,
 privacy_version VARCHAR(32) NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS email_marketing (
 user_id INT PRIMARY KEY,
 email VARCHAR(254) NOT NULL,
 subscribed BOOLEAN NOT NULL DEFAULT FALSE,
 unsubscribe_id CHAR(36) NOT NULL,
 consent_at DATETIME(3) NULL,
 unsubscribed_at DATETIME(3) NULL,
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY marketing_email(email),
 UNIQUE KEY unsubscribe_id(unsubscribe_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS marketing_jobs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 user_id INT NOT NULL,
 email VARCHAR(254) NOT NULL,
 kind VARCHAR(32) NOT NULL DEFAULT 'welcome',
 due_at DATETIME(3) NOT NULL,
 sent_at DATETIME(3) NULL,
 cancelled_at DATETIME(3) NULL,
 attempts INT NOT NULL DEFAULT 0,
 last_error VARCHAR(120) NULL,
 UNIQUE KEY welcome_once(user_id,kind),
 KEY ready_jobs(sent_at,cancelled_at,due_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS marketing_contact_sync (
 email VARCHAR(254) PRIMARY KEY,
 subscribed BOOLEAN NOT NULL,
 synced_at DATETIME(3) NULL,
 next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 attempts INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS email_webhook_events (
 id VARCHAR(128) PRIMARY KEY,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
