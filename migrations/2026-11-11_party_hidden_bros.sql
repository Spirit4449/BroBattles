-- Keep existing party portraits visible unless the owner opts in.
ALTER TABLE parties ADD COLUMN hide_enemy_bros TINYINT(1) NOT NULL DEFAULT 0;
