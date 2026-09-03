-- Additive, rerunnable migration. Apply before enabling bots in runtime-overrides.json.
-- Stop old matchmaking workers before running the entire file.
CREATE TABLE IF NOT EXISTS match_bot_participants (
  participant_id VARCHAR(64) NOT NULL,
  match_id INT NOT NULL,
  name VARCHAR(50) NOT NULL,
  team ENUM('team1','team2') NOT NULL,
  char_class VARCHAR(50) NOT NULL,
  level TINYINT UNSIGNED NOT NULL,
  trophies INT NOT NULL DEFAULT 0,
  seed BIGINT UNSIGNED NOT NULL,
  difficulty JSON NOT NULL,
  health_override INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (participant_id),
  UNIQUE KEY uq_match_bot_name (match_id, name),
  CONSTRAINT fk_bot_match FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
);

-- These intentional backfills cover the existing queue. Temporarily relax safe
-- updates for this connection only (including MySQL Workbench), then restore it.
SET @adaptive_bots_previous_safe_updates = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;
START TRANSACTION;

-- Preserve ticket age while changing the rating unit to account trophies.
UPDATE match_tickets mt LEFT JOIN users u ON u.user_id = mt.user_id
  SET mt.mmr = GREATEST(0, COALESCE(u.trophies, 0)) WHERE mt.party_id IS NULL;
UPDATE match_tickets mt JOIN (
  SELECT pm.party_id, ROUND(AVG(GREATEST(0, COALESCE(u.trophies, 0)))) rating
  FROM party_members pm JOIN users u ON u.name = pm.name GROUP BY pm.party_id
) p ON p.party_id = mt.party_id SET mt.mmr = p.rating;

-- New assembly holds row locks until commit and no longer persists claims.
UPDATE match_tickets SET claimed_by = NULL WHERE status = 'queued';

COMMIT;
SET SESSION SQL_SAFE_UPDATES = @adaptive_bots_previous_safe_updates;
