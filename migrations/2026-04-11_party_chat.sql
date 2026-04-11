CREATE TABLE IF NOT EXISTS party_chat_messages (
	message_id INT NOT NULL AUTO_INCREMENT,
	party_id INT NOT NULL,
	user_id INT NOT NULL,
	reply_to_message_id INT NULL,
	body TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	PRIMARY KEY (message_id),
	INDEX idx_party_chat_messages_party_message (party_id, message_id),
	INDEX idx_party_chat_messages_user_id (user_id),
	CONSTRAINT fk_party_chat_messages_party
		FOREIGN KEY (party_id) REFERENCES parties(party_id)
		ON DELETE CASCADE,
	CONSTRAINT fk_party_chat_messages_user
		FOREIGN KEY (user_id) REFERENCES users(user_id)
		ON DELETE CASCADE,
	CONSTRAINT fk_party_chat_messages_reply
		FOREIGN KEY (reply_to_message_id) REFERENCES party_chat_messages(message_id)
		ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS party_chat_message_reactions (
	party_id INT NOT NULL,
	message_id INT NOT NULL,
	user_id INT NOT NULL,
	reaction VARCHAR(16) NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (party_id, message_id, user_id),
	INDEX idx_party_chat_message_reactions_message (message_id),
	INDEX idx_party_chat_message_reactions_user (user_id),
	CONSTRAINT fk_party_chat_message_reactions_party
		FOREIGN KEY (party_id) REFERENCES parties(party_id)
		ON DELETE CASCADE,
	CONSTRAINT fk_party_chat_message_reactions_message
		FOREIGN KEY (message_id) REFERENCES party_chat_messages(message_id)
		ON DELETE CASCADE,
	CONSTRAINT fk_party_chat_message_reactions_user
		FOREIGN KEY (user_id) REFERENCES users(user_id)
		ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS party_chat_message_reads (
	party_id INT NOT NULL,
	message_id INT NOT NULL,
	user_id INT NOT NULL,
	read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (party_id, message_id, user_id),
	INDEX idx_party_chat_message_reads_party_user (party_id, user_id),
	INDEX idx_party_chat_message_reads_message (message_id),
	CONSTRAINT fk_party_chat_message_reads_party
		FOREIGN KEY (party_id) REFERENCES parties(party_id)
		ON DELETE CASCADE,
	CONSTRAINT fk_party_chat_message_reads_message
		FOREIGN KEY (message_id) REFERENCES party_chat_messages(message_id)
		ON DELETE CASCADE,
	CONSTRAINT fk_party_chat_message_reads_user
		FOREIGN KEY (user_id) REFERENCES users(user_id)
		ON DELETE CASCADE
);