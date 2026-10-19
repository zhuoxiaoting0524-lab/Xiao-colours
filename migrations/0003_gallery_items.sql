-- Private Gallery items. Every row is owned by one authenticated user.

CREATE TABLE gallery_items (
  id TEXT PRIMARY KEY NOT NULL,
  gallery_id TEXT NOT NULL REFERENCES galleries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL UNIQUE REFERENCES media_objects(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('places', 'nature', 'moments')) DEFAULT 'moments',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (gallery_id, position)
);

CREATE INDEX gallery_items_user_position_idx
  ON gallery_items (user_id, position);

CREATE INDEX gallery_items_gallery_idx
  ON gallery_items (gallery_id);
