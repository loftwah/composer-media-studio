-- A publication's chosen poster now gets its own page-size WebP beside the
-- gallery thumb. `source_sha256` records which poster bytes produced the row so
-- a replaced poster can never be served from a stale derivative.
--
-- SQLite cannot widen a CHECK in place, so rebuild the table and copy every
-- existing thumb row unchanged.
CREATE TABLE publication_derivatives_v2 (
  publication_id TEXT NOT NULL REFERENCES publications(id),
  kind TEXT NOT NULL CHECK (kind IN ('thumb', 'poster')),
  r2_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  sha256 TEXT NOT NULL,
  source_sha256 TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (publication_id, kind)
);
INSERT INTO publication_derivatives_v2(publication_id,kind,r2_key,mime,bytes,width,height,sha256,created_at)
  SELECT publication_id,kind,r2_key,mime,bytes,width,height,sha256,created_at FROM publication_derivatives;
DROP TABLE publication_derivatives;
ALTER TABLE publication_derivatives_v2 RENAME TO publication_derivatives;
