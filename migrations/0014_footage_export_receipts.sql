-- Project-private provenance for browser-reported source-scene exports.
CREATE TABLE footage_export_receipts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  output_asset_id TEXT NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL,
  source_asset_id TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX footage_export_receipts_project ON footage_export_receipts(project_id, created_at);
