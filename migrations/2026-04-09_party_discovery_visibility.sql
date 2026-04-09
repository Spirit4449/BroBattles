-- Party discovery + visibility settings
-- Adds public/private controls and a public party name.

ALTER TABLE parties
  ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN public_name VARCHAR(32) NULL;

CREATE INDEX idx_parties_is_public ON parties (is_public);
CREATE INDEX idx_parties_public_name ON parties (public_name);
