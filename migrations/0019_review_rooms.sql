-- Private, version-pinned creative review rooms.
--
-- A room points at one exact saved asset and stores the asset SHA-256 at the
-- time the link is created. It is not a second media store: the bytes stay in
-- R2 and the asset row stays the source of truth. Only a one-way hash of the
-- link token is stored, so a database read cannot mint a working link.
CREATE TABLE IF NOT EXISTS review_rooms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  asset_sha256 TEXT NOT NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('image', 'video')),
  asset_mime TEXT NOT NULL,
  asset_title TEXT NOT NULL,
  asset_bytes INTEGER NOT NULL,
  asset_width INTEGER,
  asset_height INTEGER,
  asset_duration_ms INTEGER,
  version_label TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'saved_asset' CHECK (source_kind IN ('saved_asset', 'storyboard_render')),
  composition_id TEXT,
  composition_revision INTEGER,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  decision TEXT NOT NULL DEFAULT 'awaiting_review' CHECK (decision IN ('awaiting_review', 'changes_requested', 'approved')),
  decided_at INTEGER,
  decision_note TEXT NOT NULL DEFAULT '',
  reviewer_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS review_rooms_project ON review_rooms(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS review_rooms_asset ON review_rooms(project_id, asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS review_rooms_token ON review_rooms(token_hash);

-- Feedback is append-only from a reviewer's side and always names the exact
-- version hash it was written against. Comments are untrusted data.
CREATE TABLE IF NOT EXISTS review_feedback (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES review_rooms(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  version_sha256 TEXT NOT NULL,
  reviewer_name TEXT NOT NULL,
  body TEXT NOT NULL,
  at_ms INTEGER,
  end_ms INTEGER,
  region_json TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS review_feedback_room ON review_feedback(room_id, created_at ASC);

-- A deliberate reviewer decision is kept as history. The room row carries the
-- latest decision for cheap reads; this table is the audit trail.
CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES review_rooms(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  decision TEXT NOT NULL CHECK (decision IN ('changes_requested', 'approved')),
  note TEXT NOT NULL DEFAULT '',
  reviewer_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS review_decisions_room ON review_decisions(room_id, created_at DESC);

-- Bounded failed-token and feedback attempts. The key is an environment/IP or
-- token hash, never the raw token.
CREATE TABLE IF NOT EXISTS review_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS review_attempts_reset ON review_attempts(reset_at);
