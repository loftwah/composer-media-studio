-- Existing public URLs stay unlisted until explicitly added to the gallery.
ALTER TABLE publications ADD COLUMN listed INTEGER NOT NULL DEFAULT 0 CHECK (listed IN (0, 1));
CREATE INDEX IF NOT EXISTS publications_catalogue ON publications(listed, revoked_at, created_at DESC, id DESC);
