-- Footprints globe/search metadata and one private cover photo per record.
-- Additive only; no existing rows or legacy data are removed.

ALTER TABLE footprints ADD COLUMN name_zh TEXT;
ALTER TABLE footprints ADD COLUMN name_en TEXT;
ALTER TABLE footprints ADD COLUMN country_code TEXT;
ALTER TABLE footprints ADD COLUMN place_type TEXT;

CREATE TABLE footprint_photos (
  id TEXT PRIMARY KEY NOT NULL,
  footprint_id TEXT NOT NULL UNIQUE REFERENCES footprints(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 716800),
  image_data BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX footprint_photos_user_idx
  ON footprint_photos (user_id, updated_at DESC);
