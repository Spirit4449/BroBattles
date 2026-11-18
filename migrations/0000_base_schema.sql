-- Schema for the six original game tables. No player data or post-bootstrap columns.

CREATE TABLE IF NOT EXISTS users (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `socket_id` varchar(100) DEFAULT NULL,
  `char_class` varchar(50) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `expires_at` datetime DEFAULT NULL,
  `char_levels` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `coins` int DEFAULT '0',
  `gems` int DEFAULT '0',
  `trophies` int DEFAULT NULL,
  `password` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `preferred_mode_id` varchar(64) DEFAULT NULL,
  `preferred_mode_variant_id` varchar(64) DEFAULT NULL,
  `preferred_map_id` int DEFAULT NULL,
  `abuse_offense_count` int NOT NULL DEFAULT '0',
  `abuse_offense_window_expires_at` datetime DEFAULT NULL,
  `abuse_suspension_count` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `name` (`name`),
  CONSTRAINT `users_chk_1` CHECK (json_valid(`char_levels`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parties (
  `party_id` int NOT NULL AUTO_INCREMENT,
  `status` enum('idle','queued','ready_check','live') NOT NULL DEFAULT 'idle',
  `mode` int DEFAULT NULL,
  `map` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`party_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS party_members (
  `party_id` int NOT NULL,
  `name` varchar(50) NOT NULL,
  `team` enum('team1','team2') NOT NULL,
  `joined_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`party_id`,`name`),
  KEY `fk_pm_user_name` (`name`),
  CONSTRAINT `fk_pm_party` FOREIGN KEY (`party_id`) REFERENCES `parties` (`party_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pm_user_name` FOREIGN KEY (`name`) REFERENCES `users` (`name`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matches (
  `match_id` int NOT NULL AUTO_INCREMENT,
  `mode` int NOT NULL,
  `map` int NOT NULL,
  `status` enum('queued','live','completed','cancelled') NOT NULL DEFAULT 'queued',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`match_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_participants (
  `match_id` int NOT NULL,
  `user_id` int NOT NULL,
  `party_id` int DEFAULT NULL,
  `team` enum('team1','team2') NOT NULL,
  `char_class` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`match_id`,`user_id`),
  KEY `fk_mp_user` (`user_id`),
  KEY `fk_mp_party` (`party_id`),
  CONSTRAINT `fk_mp_match` FOREIGN KEY (`match_id`) REFERENCES `matches` (`match_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mp_party` FOREIGN KEY (`party_id`) REFERENCES `parties` (`party_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mp_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_tickets (
  `ticket_id` int NOT NULL AUTO_INCREMENT,
  `party_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `mode` int NOT NULL,
  `map` int NOT NULL,
  `size` tinyint NOT NULL,
  `mmr` int NOT NULL,
  `team1_count` tinyint NOT NULL DEFAULT '0',
  `team2_count` tinyint NOT NULL DEFAULT '0',
  `status` enum('queued','cancelled') NOT NULL DEFAULT 'queued',
  `claimed_by` varchar(64) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`ticket_id`),
  UNIQUE KEY `party_id` (`party_id`),
  UNIQUE KEY `user_id` (`user_id`),
  CONSTRAINT `fk_mt_party` FOREIGN KEY (`party_id`) REFERENCES `parties` (`party_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mt_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
