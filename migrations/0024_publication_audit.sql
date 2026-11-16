-- Every deliberate bulk visibility change records its actor, the exact previous
-- state and the resulting state. Audit rows are append-only and survive a
-- withdrawal; they never carry prompts, captions, media bytes or tokens.
CREATE TABLE IF NOT EXISTS publication_audit (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  publication_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_name TEXT,
  session_mode TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish', 'unlist', 'withdraw')),
  previous_state TEXT NOT NULL,
  resulting_state TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS publication_audit_project ON publication_audit(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publication_audit_publication ON publication_audit(publication_id, created_at DESC);
