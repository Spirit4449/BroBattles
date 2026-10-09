-- Apply with npm run migrate:apply -- privacy-settings (safe to re-run).
-- No row means every default, so existing accounts need no backfill.
CREATE TABLE IF NOT EXISTS user_privacy_settings (
	user_id INT NOT NULL,
	friend_requests ENUM('everyone','recent','none') NOT NULL DEFAULT 'everyone',
	messages ENUM('friends','none') NOT NULL DEFAULT 'friends',
	party_invites ENUM('friends','none') NOT NULL DEFAULT 'friends',
	last_seen ENUM('friends','none') NOT NULL DEFAULT 'friends',
	read_receipts BOOLEAN NOT NULL DEFAULT TRUE,
	show_in_suggestions BOOLEAN NOT NULL DEFAULT TRUE,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id),
	CONSTRAINT fk_user_privacy_settings_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
