-- Expand Footprints from one cover photo per place to a private one-to-many album.
-- The legacy table is retained as a rollback copy; every existing photo is copied
-- into the new table as position 0 and remains the cover photo.

ALTER TABLE footprint_photos RENAME TO footprint_photos_legacy;
DROP INDEX IF EXISTS footprint_photos_user_idx;

CREATE TABLE footprint_photos (
  id TEXT PRIMARY KEY NOT NULL,
  footprint_id TEXT NOT NULL REFERENCES footprints(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 716800),
  image_data BLOB NOT NULL,
  original_name TEXT,
  caption TEXT,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  is_cover INTEGER NOT NULL DEFAULT 0 CHECK (is_cover IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO footprint_photos (
  id, footprint_id, user_id, content_type, byte_size, image_data,
  original_name, caption, position, is_cover, created_at, updated_at
)
SELECT
  id, footprint_id, user_id, content_type, byte_size, image_data,
  NULL, NULL, 0, 1, created_at, updated_at
FROM footprint_photos_legacy;

CREATE INDEX footprint_photos_user_idx
  ON footprint_photos (user_id, updated_at DESC);

CREATE INDEX footprint_photos_place_idx
  ON footprint_photos (footprint_id, position ASC, created_at ASC);

CREATE UNIQUE INDEX footprint_photos_one_cover_idx
  ON footprint_photos (footprint_id)
  WHERE is_cover = 1;
