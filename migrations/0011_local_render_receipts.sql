-- Private snapshots for browser-reported local renders. An output is bound by
-- the deterministic asset id only when its asset row exists.
CREATE TABLE local_render_receipts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  output_asset_id TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX local_render_receipts_project ON local_render_receipts(project_id, created_at);
