-- IELTS Speaking Studio. Additive only; no existing tables or rows are modified.
PRAGMA foreign_keys = ON;

CREATE TABLE speaking_custom_questions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  part INTEGER NOT NULL CHECK (part BETWEEN 1 AND 3),
  topic TEXT NOT NULL,
  question_en TEXT NOT NULL,
  question_zh TEXT NOT NULL DEFAULT '',
  cue_points_json TEXT NOT NULL DEFAULT '[]',
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX speaking_custom_questions_user_idx ON speaking_custom_questions (user_id, created_at DESC);

CREATE TABLE speaking_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('daily','topic','mock')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX speaking_sessions_user_started_idx ON speaking_sessions (user_id, started_at DESC);

CREATE TABLE speaking_answers (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT REFERENCES speaking_sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  part INTEGER NOT NULL CHECK (part BETWEEN 1 AND 3),
  topic TEXT NOT NULL,
  question_en TEXT NOT NULL,
  transcript TEXT NOT NULL DEFAULT '',
  corrected_transcript TEXT NOT NULL DEFAULT '',
  audio_local_id TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0 AND duration_seconds <= 900),
  retry_of TEXT REFERENCES speaking_answers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX speaking_answers_user_created_idx ON speaking_answers (user_id, created_at DESC);
CREATE INDEX speaking_answers_user_question_idx ON speaking_answers (user_id, question_id, created_at DESC);

CREATE TABLE speaking_feedback (
  id TEXT PRIMARY KEY NOT NULL,
  answer_id TEXT NOT NULL UNIQUE REFERENCES speaking_answers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_json TEXT NOT NULL,
  model_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX speaking_feedback_user_created_idx ON speaking_feedback (user_id, created_at DESC);

CREATE TABLE speaking_saved_expressions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expression_en TEXT NOT NULL,
  explanation_zh TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT 'General',
  source_question_id TEXT,
  review_status TEXT NOT NULL DEFAULT 'new' CHECK (review_status IN ('new','learning','reviewed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX speaking_saved_expressions_user_topic_idx ON speaking_saved_expressions (user_id, topic, created_at DESC);

CREATE TABLE speaking_review_items (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, question_id)
);
CREATE INDEX speaking_review_items_user_open_idx ON speaking_review_items (user_id, resolved_at, created_at DESC);

CREATE TABLE speaking_question_marks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE speaking_daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date_utc TEXT NOT NULL,
  estimated_neurons INTEGER NOT NULL DEFAULT 0 CHECK (estimated_neurons >= 0),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0,1)),
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, usage_date_utc)
);
