-- XiaoColour Little Notes + My Days.
-- Additive only: the legacy Journal, Gallery and Collections tables/data remain untouched.

CREATE TABLE personal_notes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL CHECK (color IN ('ivory', 'sage', 'blue', 'rose')) DEFAULT 'ivory',
  is_pinned INTEGER NOT NULL CHECK (is_pinned IN (0, 1)) DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX personal_notes_user_pinned_updated_idx
  ON personal_notes (user_id, is_pinned DESC, updated_at DESC);

CREATE TABLE day_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  task_date TEXT NOT NULL,
  task_time TEXT,
  tag TEXT NOT NULL CHECK (tag IN ('Personal', 'Study', 'Health', 'Home')) DEFAULT 'Personal',
  is_completed INTEGER NOT NULL CHECK (is_completed IN (0, 1)) DEFAULT 0,
  repeat_rule TEXT NOT NULL CHECK (repeat_rule IN ('none', 'daily', 'weekly', 'monthly')) DEFAULT 'none',
  recurrence_group_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX day_tasks_user_date_time_idx
  ON day_tasks (user_id, task_date, task_time);

CREATE INDEX day_tasks_user_recurrence_idx
  ON day_tasks (user_id, recurrence_group_id);

CREATE TABLE important_dates (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  repeat_rule TEXT NOT NULL CHECK (repeat_rule IN ('none', 'yearly')) DEFAULT 'none',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX important_dates_user_date_idx
  ON important_dates (user_id, event_date);
