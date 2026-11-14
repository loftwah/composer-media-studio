-- Public-safe verified credit snapshot, separate from private prompts and captions.
ALTER TABLE publications ADD COLUMN attribution_json TEXT NOT NULL DEFAULT '[]';
