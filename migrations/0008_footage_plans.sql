-- Additive: source video assets and existing compositions are not modified.
CREATE TABLE footage_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_asset_id TEXT NOT NULL REFERENCES assets(id),
  source_sha256 TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX footage_plans_project ON footage_plans(project_id, updated_at DESC);
