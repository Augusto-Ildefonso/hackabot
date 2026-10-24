CREATE TABLE IF NOT EXISTS users (
  chat_id INTEGER PRIMARY KEY,
  paused INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  rate_window_start INTEGER NOT NULL DEFAULT 0,
  rate_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS filters (
  chat_id INTEGER NOT NULL REFERENCES users(chat_id) ON DELETE CASCADE,
  field TEXT NOT NULL CHECK (field IN ('organizer', 'theme', 'location')),
  value TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('allow', 'block')),
  PRIMARY KEY (chat_id, field, value, mode)
);

CREATE TABLE IF NOT EXISTS hackathons (
  id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
