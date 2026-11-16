-- One short-lived, single-use handoff for an agent to PUT a saved original
-- that is too large for a bounded JSON-RPC tool result. The row stores the
-- nonce and consumed state; the URL signature covers the project, expiry,
-- declared SHA-256 and declared byte count. A link never carries a session
-- cookie and stops working when its agent connection is revoked.
CREATE TABLE IF NOT EXISTS asset_upload_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  mime TEXT NOT NULL,
  filename TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  asset_id TEXT
);
-- The expiry sweep and a project's own link lookup are the only access paths.
CREATE INDEX IF NOT EXISTS asset_upload_links_expiry ON asset_upload_links(expires_at);
CREATE INDEX IF NOT EXISTS asset_upload_links_project ON asset_upload_links(project_id, consumed_at);
