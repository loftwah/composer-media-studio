-- Fast gallery previews are derived from a published asset and can be rebuilt.
-- They are deliberately not `assets` rows: a derivative is not library work,
-- must not appear in portable exports, and may be replaced at any time.
CREATE TABLE IF NOT EXISTS publication_derivatives (
  publication_id TEXT NOT NULL REFERENCES publications(id),
  kind TEXT NOT NULL CHECK (kind IN ('thumb')),
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (publication_id, kind)
);
