-- Both an installation allowlist and a project-scoped rights attestation are required.
CREATE TABLE IF NOT EXISTS publication_policies (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  enabled_at INTEGER NOT NULL,
  attested_at INTEGER NOT NULL
);
