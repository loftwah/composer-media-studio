-- An owner library card needs a small still of one stored image. The preview is
-- derived from that asset and can be rebuilt at any time. It is deliberately not
-- an `assets` row: it never enters the library, a portable export or a public
-- page, and its bytes are private to the owner session.
CREATE TABLE IF NOT EXISTS asset_previews (
  asset_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Backfill and erasure both look up one asset at a time; project scope is the
-- only grouping a reader needs.
CREATE INDEX IF NOT EXISTS asset_previews_project ON asset_previews(project_id);
