-- A publication can record the private review decision it was approved by.
-- This is provenance, not permission: publishing is still a separate action,
-- and an unapproved asset publishes exactly as it did before.
ALTER TABLE publications ADD COLUMN review_room_id TEXT;
ALTER TABLE publications ADD COLUMN review_decision TEXT;
ALTER TABLE publications ADD COLUMN review_asset_sha256 TEXT;
