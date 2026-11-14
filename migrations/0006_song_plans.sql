-- Additive only: existing assets, compositions and renders remain unchanged.
CREATE TABLE song_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  song_asset_id TEXT NOT NULL REFERENCES assets(id),
  song_sha256 TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX song_plans_project ON song_plans(project_id, updated_at DESC);
