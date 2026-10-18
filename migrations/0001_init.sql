-- XiaoColour multi-user foundation (phase 1)
-- Safe to apply on empty D1. Does not touch Global Pulse KV.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')) DEFAULT 'member',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  used_by TEXT REFERENCES users(id),
  revoked_at TEXT,
  note TEXT
);

CREATE INDEX invites_expires_idx ON invites (expires_at);
CREATE INDEX invites_status_idx ON invites (revoked_at, used_at);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT
);

CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE login_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  key_hash TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX login_attempts_key_idx ON login_attempts (key_hash, attempted_at);

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT
);

-- Per-user private content shells (phase 1: empty containers only)
CREATE TABLE journals (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE galleries (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE collections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Future R2 object keys will live here; no media upload in phase 1.
CREATE TABLE media_objects (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space TEXT NOT NULL CHECK (space IN ('journal', 'gallery', 'collections')),
  r2_key TEXT NOT NULL,
  content_type TEXT,
  byte_size INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, r2_key)
);
