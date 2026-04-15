CREATE TABLE IF NOT EXISTS party_join_requests (
	request_id INT NOT NULL AUTO_INCREMENT,
	party_id INT NOT NULL,
	requester_user_id INT NOT NULL,
	request_count TINYINT NOT NULL DEFAULT 1,
	status ENUM('pending','accepted','rejected','expired') NOT NULL DEFAULT 'pending',
	requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	responded_at TIMESTAMP NULL DEFAULT NULL,
	PRIMARY KEY (request_id),
	UNIQUE KEY uniq_party_join_requests_party_user (party_id, requester_user_id),
	INDEX idx_party_join_requests_party_status (party_id, status),
	INDEX idx_party_join_requests_requester (requester_user_id),
	CONSTRAINT fk_party_join_requests_party
		FOREIGN KEY (party_id) REFERENCES parties(party_id)
		ON DELETE CASCADE,
	CONSTRAINT fk_party_join_requests_requester
		FOREIGN KEY (requester_user_id) REFERENCES users(user_id)
		ON DELETE CASCADE
);