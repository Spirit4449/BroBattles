CREATE TABLE IF NOT EXISTS account_emails (
 user_id INT NOT NULL PRIMARY KEY,
 email VARCHAR(254) NULL,
 verified_at DATETIME(3) NULL,
 pending_email VARCHAR(254) NULL,
 code_hash CHAR(64) NULL,
 expires_at DATETIME(3) NULL,
 attempts INT NOT NULL DEFAULT 0,
 sent_at DATETIME(3) NULL,
 window_start DATETIME(3) NULL,
 send_count INT NOT NULL DEFAULT 0,
 correction_used BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE KEY verified_email (email)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS email_outbox (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 request_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 sent_at DATETIME(3) NULL,
 attempts INT NOT NULL DEFAULT 0,
 next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY notification_request (request_id),
 FOREIGN KEY (request_id) REFERENCES site_requests(id) ON DELETE CASCADE
) ENGINE=InnoDB;
