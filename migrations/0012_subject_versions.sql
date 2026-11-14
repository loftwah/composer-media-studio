-- Project-private, append-only approved subject versions. Existing media stays owned by its project.
CREATE TABLE subject_versions (
  subject_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  spec_json TEXT NOT NULL,
  reference_asset_id TEXT NOT NULL,
  reference_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (subject_id, revision)
);
CREATE INDEX subject_versions_project ON subject_versions(project_id, subject_id, revision DESC);
