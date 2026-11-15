-- Bind each Studio project to the App Composer workspace that created it.
--
-- Projects created before this migration keep a NULL workspace on purpose:
-- assigning historical work to a workspace is a reviewed owner action, not a
-- guess made by a migration. Until then they stay installation-wide.
ALTER TABLE projects ADD COLUMN workspace_id TEXT;

CREATE INDEX IF NOT EXISTS projects_workspace ON projects(workspace_id);

-- One bounded grant check shared between isolates. A private read reuses a
-- check for GRANT_CACHE_MS, so revoking a member stops reads without adding a
-- Composer round trip to every byte range of a video.
CREATE TABLE IF NOT EXISTS grant_checks (
  key TEXT PRIMARY KEY,
  actions TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS grant_checks_expiry ON grant_checks(expires_at);
