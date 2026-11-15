-- An interrupted delete remains pending after recording the tombstone.
ALTER TABLE assets ADD COLUMN erasure_pending INTEGER NOT NULL DEFAULT 0;
CREATE INDEX assets_erasure_pending ON assets(updated_at) WHERE erasure_pending=1;
