-- XiaoColour Footprints (phase 3).
-- Additive only: existing accounts and legacy Journal/Gallery/Collections data remain untouched.

CREATE TABLE footprints (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('visited', 'wish')),
  visited_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  geocoder TEXT NOT NULL DEFAULT 'nominatim',
  source_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX footprints_user_status_updated_idx
  ON footprints (user_id, status, updated_at DESC);

CREATE TABLE geocode_cache (
  query_hash TEXT PRIMARY KEY NOT NULL,
  response_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE INDEX geocode_cache_fetched_idx
  ON geocode_cache (fetched_at);

CREATE TABLE geocode_rate_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_request_at TEXT NOT NULL
);
