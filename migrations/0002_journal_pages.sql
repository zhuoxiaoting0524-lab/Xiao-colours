-- Journal pages (phase 2 step 1). Additive only — does not alter existing tables.

CREATE TABLE journal_pages (
  id TEXT PRIMARY KEY NOT NULL,
  journal_id TEXT NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  year INTEGER NOT NULL,
  title TEXT,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (journal_id, position)
);

CREATE INDEX journal_pages_user_year_pos_idx
  ON journal_pages (user_id, year, position);

CREATE INDEX journal_pages_user_pos_idx
  ON journal_pages (user_id, position);

CREATE INDEX journal_pages_journal_idx
  ON journal_pages (journal_id);
