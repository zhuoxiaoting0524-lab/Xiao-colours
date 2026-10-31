-- XiaoColour Travel Planner.
-- Additive only: no existing table or user data is changed.

PRAGMA foreign_keys = ON;

CREATE TABLE travel_trips (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  destination_name TEXT NOT NULL,
  destination_label TEXT NOT NULL DEFAULT '',
  destination_timezone TEXT,
  country_code TEXT,
  longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  travelers INTEGER NOT NULL DEFAULT 1 CHECK (travelers BETWEEN 1 AND 99),
  budget_level TEXT NOT NULL DEFAULT 'moderate' CHECK (budget_level IN ('economy','moderate','comfortable','premium','custom')),
  budget_amount INTEGER,
  currency TEXT NOT NULL DEFAULT 'EUR',
  styles_json TEXT NOT NULL DEFAULT '[]',
  pace TEXT NOT NULL DEFAULT 'moderate' CHECK (pace IN ('relaxed','moderate','compact')),
  transport TEXT NOT NULL DEFAULT 'mixed' CHECK (transport IN ('walk','transit','drive','mixed')),
  preferences TEXT NOT NULL DEFAULT '',
  cover_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE INDEX travel_trips_user_updated_idx ON travel_trips (user_id, updated_at DESC);
CREATE INDEX travel_trips_user_dates_idx ON travel_trips (user_id, start_date, end_date);

CREATE TABLE travel_days (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_date TEXT NOT NULL,
  day_number INTEGER NOT NULL CHECK (day_number > 0),
  title TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (trip_id, day_number),
  UNIQUE (trip_id, day_date)
);

CREATE INDEX travel_days_user_trip_idx ON travel_days (user_id, trip_id, day_number);

CREATE TABLE travel_activities (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
  day_id TEXT NOT NULL REFERENCES travel_days(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  start_time TEXT,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 1440),
  activity_type TEXT NOT NULL DEFAULT 'place' CHECK (activity_type IN ('place','food','rest','transport','custom')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  place_label TEXT NOT NULL DEFAULT '',
  place_source TEXT,
  place_source_id TEXT,
  longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified','suggested','unverified')),
  website_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX travel_activities_user_day_sort_idx ON travel_activities (user_id, day_id, sort_order, start_time);
CREATE INDEX travel_activities_trip_idx ON travel_activities (trip_id, user_id);

CREATE TABLE travel_saved_places (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('attraction','restaurant','cafe','hotel','shopping','other')),
  name TEXT NOT NULL,
  location_label TEXT NOT NULL DEFAULT '',
  source_id TEXT,
  longitude REAL,
  latitude REAL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX travel_saved_places_user_trip_idx ON travel_saved_places (user_id, trip_id, created_at DESC);

CREATE TABLE travel_info_items (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('stay','transport','booking','note','link')),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  start_at TEXT,
  end_at TEXT,
  url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX travel_info_items_user_trip_idx ON travel_info_items (user_id, trip_id, created_at DESC);

CREATE TABLE travel_expenses (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('stay','transport','food','activity','shopping','other')),
  title TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL,
  expense_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX travel_expenses_user_trip_idx ON travel_expenses (user_id, trip_id, expense_date, created_at);

CREATE TABLE travel_checklist_items (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('before','during','return')),
  title TEXT NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK (is_completed IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX travel_checklist_user_trip_idx ON travel_checklist_items (user_id, trip_id, section, sort_order);

CREATE TABLE travel_versions (
  id TEXT PRIMARY KEY NOT NULL,
  trip_id TEXT NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','ai')),
  summary TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX travel_versions_user_trip_idx ON travel_versions (user_id, trip_id, created_at DESC);
