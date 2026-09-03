-- Preserve existing member map/mode access; owners can turn it off in settings.
ALTER TABLE parties
  ADD COLUMN allow_member_selection TINYINT(1) NOT NULL DEFAULT 1;
