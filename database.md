mysql> describe match_participants;
+------------+-----------------------+------+-----+---------+-------+
| Field | Type | Null | Key | Default | Extra |
+------------+-----------------------+------+-----+---------+-------+
| match_id | int | NO | PRI | NULL | |
| user_id | int | NO | PRI | NULL | |
| party_id | int | YES | MUL | NULL | |
| team | enum('team1','team2') | NO | | NULL | |
| char_class | varchar(50) | YES | | NULL | |
+------------+-----------------------+------+-----+---------+-------+
5 rows in set (0.00 sec)

mysql> describe match_tickets;
+-------------+----------------------------+------+-----+-------------------+-------------------+
| Field | Type | Null | Key | Default | Extra |
+-------------+----------------------------+------+-----+-------------------+-------------------+
| ticket_id | int | NO | PRI | NULL | auto_increment |
| party_id | int | YES | UNI | NULL | |
| user_id | int | YES | UNI | NULL | |
| mode | int | NO | | NULL | |
| map | int | NO | | NULL | |
| size | tinyint | NO | | NULL | |
| mmr | int | NO | | NULL | |
| team1_count | tinyint | NO | | 0 | |
| team2_count | tinyint | NO | | 0 | |
| status | enum('queued','cancelled') | NO | | queued | |
| claimed_by | varchar(64) | YES | | NULL | |
| created_at | timestamp | NO | | CURRENT_TIMESTAMP | DEFAULT_GENERATED |
+-------------+----------------------------+------+-----+-------------------+-------------------+
12 rows in set (0.00 sec)

mysql> describe matches;
+------------+-----------------------------------------------+------+-----+-------------------+-------------------+
| Field | Type | Null | Key | Default | Extra |
+------------+-----------------------------------------------+------+-----+-------------------+-------------------+
| match_id | int | NO | PRI | NULL | auto_increment |
| mode | int | NO | | NULL | |
| map | int | NO | | NULL | |
| status | enum('queued','live','completed','cancelled') | NO | | queued | |
| created_at | timestamp | NO | | CURRENT_TIMESTAMP | DEFAULT_GENERATED |
+------------+-----------------------------------------------+------+-----+-------------------+-------------------+
5 rows in set (0.00 sec)

mysql> describe users;
+-------------+--------------+------+-----+-------------------+-----------------------------------------------+
| Field | Type | Null | Key | Default | Extra |
+-------------+--------------+------+-----+-------------------+-----------------------------------------------+
| user_id | int | NO | PRI | NULL | auto_increment |
| name | varchar(50) | NO | UNI | NULL | |
| socket_id | varchar(100) | YES | | NULL | |
| char_class | varchar(50) | YES | | NULL | |
| status | varchar(50) | YES | | NULL | |
| expires_at | datetime | YES | | NULL | |
| char_levels | json | YES | | NULL | |
| coins | int | YES | | 0 | |
| gems | int | YES | | 0 | |
| trophies | int | YES | | NULL | |
| password | text | YES | | NULL | |
| created_at | datetime | NO | | CURRENT_TIMESTAMP | DEFAULT_GENERATED |
| updated_at | datetime | NO | | CURRENT_TIMESTAMP | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |
+-------------+--------------+------+-----+-------------------+-----------------------------------------------+
13 rows in set (0.00 sec)

mysql> describe parties;
+------------+--------------------------------------------+------+-----+-------------------+-------------------+
| Field | Type | Null | Key | Default | Extra |
+------------+--------------------------------------------+------+-----+-------------------+-------------------+
| party_id | int | NO | PRI | NULL | auto_increment |
| status | enum('idle','queued','ready_check','live') | NO | | idle | |
| mode | int | YES | | NULL | |
| map | int | YES | | NULL | |
| created_at | timestamp | YES | | CURRENT_TIMESTAMP | DEFAULT_GENERATED |
+------------+--------------------------------------------+------+-----+-------------------+-------------------+
5 rows in set (0.03 sec)

mysql> describe party_members;
+-----------+-----------------------+------+-----+-------------------+-----------------------------------------------+
| Field | Type | Null | Key | Default | Extra |
+-----------+-----------------------+------+-----+-------------------+-----------------------------------------------+
| party_id | int | NO | PRI | NULL | |
| name | varchar(50) | NO | PRI | NULL | |
| team | enum('team1','team2') | NO | | NULL | |
| joined_at | timestamp | YES | | CURRENT_TIMESTAMP | DEFAULT_GENERATED |
| last_seen | timestamp | NO | | CURRENT_TIMESTAMP | DEFAULT_GENERATED on update CURRENT_TIMESTAMP |
+-----------+-----------------------+------+-----+-------------------+-----------------------------------------------+
5 rows in set (0.00 sec)

mysql>

## Game Mode Registry Scaffold

Apply [migrations/2026-03-25_game_mode_registry_scaffold.sql](migrations/2026-03-25_game_mode_registry_scaffold.sql)
to add `mode_id` and `mode_variant_id` to `parties`, `matches`, and
`match_tickets`, and to backfill existing duel rows from the legacy numeric
`mode` values.

## Player Cards (Planned Feature)

Card metadata (name, asset URL, costs, render zones) is sourced from
`src/config/player-cards.catalog.json`.
Database stores ownership and equipped selection only.

### Migration

```sql
ALTER TABLE users
	ADD COLUMN selected_card_id VARCHAR(64) NULL;

CREATE TABLE IF NOT EXISTS user_cards (
	user_id INT NOT NULL,
	card_id VARCHAR(64) NOT NULL,
	acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	source VARCHAR(32) NOT NULL DEFAULT 'grant',
	PRIMARY KEY (user_id, card_id),
	CONSTRAINT fk_user_cards_user
		FOREIGN KEY (user_id) REFERENCES users(user_id)
		ON DELETE CASCADE
);

CREATE INDEX idx_user_cards_user_id ON user_cards(user_id);
```

### Seed Starter Card (Optional)

```sql
INSERT IGNORE INTO user_cards (user_id, card_id, source)
SELECT user_id, 'starter_ninja_frame', 'starter'
FROM users;

UPDATE users
SET selected_card_id = COALESCE(selected_card_id, 'starter_ninja_frame');
```

## Trophy Reward Claims (Progression Track)

Apply [migrations/2026-04-06_trophy_reward_claims.sql](migrations/2026-04-06_trophy_reward_claims.sql)
to persist claimed trophy-track rewards and prevent duplicate claim payouts.

### Migration

```sql
CREATE TABLE IF NOT EXISTS user_trophy_reward_claims (
	user_id INT NOT NULL,
	tier_id VARCHAR(64) NOT NULL,
	claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (user_id, tier_id),
	CONSTRAINT fk_user_trophy_reward_claims_user
		FOREIGN KEY (user_id) REFERENCES users(user_id)
		ON DELETE CASCADE
);

CREATE INDEX idx_user_trophy_reward_claims_user
	ON user_trophy_reward_claims(user_id);
```
