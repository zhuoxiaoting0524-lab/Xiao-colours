-- Footprints country archives. Additive only; existing footprints/photos remain unchanged.
PRAGMA foreign_keys = ON;

CREATE TABLE country_archives (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL CHECK (length(country_code) = 2),
  name_zh TEXT,
  name_en TEXT,
  start_date TEXT,
  end_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, country_code)
);
CREATE INDEX country_archives_user_updated_idx ON country_archives (user_id, updated_at DESC);

CREATE TABLE country_experiences (
  id TEXT PRIMARY KEY NOT NULL,
  archive_id TEXT NOT NULL REFERENCES country_archives(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  footprint_id TEXT REFERENCES footprints(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('food','cafe','sight','shopping','stay','entertainment','other')),
  city TEXT,
  longitude REAL,
  latitude REAL,
  experience_date TEXT,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  note TEXT NOT NULL DEFAULT '',
  revisit INTEGER CHECK (revisit IS NULL OR revisit IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX country_experiences_user_archive_idx ON country_experiences (user_id, archive_id, experience_date DESC, created_at DESC);

CREATE TABLE country_experience_photos (
  id TEXT PRIMARY KEY NOT NULL,
  experience_id TEXT NOT NULL REFERENCES country_experiences(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 716800),
  image_data BLOB NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX country_experience_photos_user_experience_idx ON country_experience_photos (user_id, experience_id, sort_order);

CREATE TABLE country_expenses (
  id TEXT PRIMARY KEY NOT NULL,
  archive_id TEXT NOT NULL REFERENCES country_archives(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  experience_id TEXT UNIQUE REFERENCES country_experiences(id) ON DELETE CASCADE,
  footprint_id TEXT REFERENCES footprints(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('food','stay','transport','activity','shopping','other')),
  title TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  expense_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX country_expenses_user_archive_currency_idx ON country_expenses (user_id, archive_id, currency, expense_date DESC);

CREATE TABLE country_route_days (
  id TEXT PRIMARY KEY NOT NULL,
  archive_id TEXT NOT NULL REFERENCES country_archives(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_type TEXT NOT NULL CHECK (route_type IN ('planned','actual')),
  day_number INTEGER NOT NULL CHECK (day_number > 0),
  route_date TEXT,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (archive_id, route_type, day_number)
);
CREATE INDEX country_route_days_user_archive_idx ON country_route_days (user_id, archive_id, route_type, day_number);

CREATE TABLE country_route_items (
  id TEXT PRIMARY KEY NOT NULL,
  route_day_id TEXT NOT NULL REFERENCES country_route_days(id) ON DELETE CASCADE,
  archive_id TEXT NOT NULL REFERENCES country_archives(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  footprint_id TEXT REFERENCES footprints(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  location_label TEXT NOT NULL DEFAULT '',
  longitude REAL NOT NULL,
  latitude REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX country_route_items_user_day_sort_idx ON country_route_items (user_id, route_day_id, sort_order);
