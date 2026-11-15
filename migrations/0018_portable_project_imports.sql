-- MIT. Restart-safe portable project restores. A staging row owns the new
-- project and asset IDs before any project becomes visible. R2 objects are
-- staged under their final project-owned keys; commit verifies every hash and
-- inserts the project rows in one D1 batch. A committed bundle is idempotent.
CREATE TABLE IF NOT EXISTS project_bundle_imports (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL UNIQUE,
  bundle_sha256 TEXT NOT NULL,
  source_project_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  id_map_json TEXT NOT NULL,
  staged_keys_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('staging', 'committed', 'failed')),
  asset_count INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  committed_at INTEGER
);
CREATE INDEX IF NOT EXISTS project_bundle_imports_project ON project_bundle_imports(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_bundle_imports_status ON project_bundle_imports(status, updated_at);
