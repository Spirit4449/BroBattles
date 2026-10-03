-- Apply with scripts/apply-friends-migration.cjs (safe to re-run).
-- users.friend_code is added by the apply script because MySQL has no
-- ADD COLUMN IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS friend_requests (
	request_id INT NOT NULL AUTO_INCREMENT,
	from_user_id INT NOT NULL,
	to_user_id INT NOT NULL,
	status ENUM('pending','accepted','declined','cancelled') NOT NULL DEFAULT 'pending',
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	responded_at TIMESTAMP NULL DEFAULT NULL,
	-- Only one pending request may exist per unordered pair.
	pending_pair VARCHAR(32) GENERATED ALWAYS AS (
		IF(status = 'pending', CONCAT(LEAST(from_user_id, to_user_id), ':', GREATEST(from_user_id, to_user_id)), NULL)
	) VIRTUAL,
	PRIMARY KEY (request_id),
	UNIQUE KEY uq_friend_requests_pending_pair (pending_pair),
	INDEX idx_friend_requests_to_status (to_user_id, status),
	INDEX idx_friend_requests_from_status (from_user_id, status),
	CONSTRAINT fk_friend_requests_from FOREIGN KEY (from_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
	CONSTRAINT fk_friend_requests_to FOREIGN KEY (to_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Stored in both directions so listing a user's friends is one indexed lookup.
CREATE TABLE IF NOT EXISTS friendships (
	user_id INT NOT NULL,
	friend_id INT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id, friend_id),
	INDEX idx_friendships_friend (friend_id),
	CONSTRAINT fk_friendships_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
	CONSTRAINT fk_friendships_friend FOREIGN KEY (friend_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS friend_messages (
	message_id INT NOT NULL AUTO_INCREMENT,
	sender_id INT NOT NULL,
	recipient_id INT NOT NULL,
	body VARCHAR(500) NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	read_at TIMESTAMP NULL DEFAULT NULL,
	user_a INT GENERATED ALWAYS AS (LEAST(sender_id, recipient_id)) VIRTUAL,
	user_b INT GENERATED ALWAYS AS (GREATEST(sender_id, recipient_id)) VIRTUAL,
	PRIMARY KEY (message_id),
	INDEX idx_friend_messages_pair (user_a, user_b, message_id),
	INDEX idx_friend_messages_unread (recipient_id, read_at),
	CONSTRAINT fk_friend_messages_sender FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE,
	CONSTRAINT fk_friend_messages_recipient FOREIGN KEY (recipient_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- One reaction per user per direct message (picking the same emoji again removes it).
CREATE TABLE IF NOT EXISTS friend_message_reactions (
	message_id INT NOT NULL,
	user_id INT NOT NULL,
	reaction VARCHAR(16) NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (message_id, user_id),
	INDEX idx_friend_message_reactions_user (user_id),
	CONSTRAINT fk_friend_message_reactions_message FOREIGN KEY (message_id) REFERENCES friend_messages(message_id) ON DELETE CASCADE,
	CONSTRAINT fk_friend_message_reactions_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
