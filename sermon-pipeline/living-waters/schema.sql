-- Living Waters — D1 schema
-- Run: wrangler d1 execute living-waters --remote --file=schema.sql

-- Core sermon record.
-- Transcript body is NOT stored here — it lives chunked in Vectorize.
-- JSON columns (main_points, application, takeaways, audience, categories) are
-- fetched whole by get_sermon / get_summary; never queried into by tools, so
-- they don't need child tables.
-- chunk_counts tracks vector counts per type so delete-before-reindex can
-- reconstruct deterministic IDs ({sermon_id}::{type}::{idx}) without scanning.
CREATE TABLE IF NOT EXISTS sermons (
  id                  TEXT PRIMARY KEY,  -- filename slug, e.g. "choosing-joy-in-weakness-habakkuk-3-17-19"
  title               TEXT NOT NULL,
  date                TEXT NOT NULL,     -- YYYY-MM-DD
  speaker             TEXT,
  series              TEXT,
  scripture           TEXT,
  primary_theme       TEXT,
  big_idea            TEXT,
  key_scripture_ref   TEXT,
  key_scripture_text  TEXT,
  key_illustration    TEXT,
  to_remember         TEXT,
  closing_prayer      TEXT,
  tag_line            TEXT,
  short_description   TEXT,
  subtitle            TEXT,
  hook                TEXT,
  style               TEXT,
  level               TEXT,
  image               TEXT,              -- NULL when MDX has empty string
  audio_url           TEXT,
  audio_size_bytes    INTEGER,
  vimeo_url           TEXT,
  duration_minutes    INTEGER,
  guid                TEXT,
  transcribed_by      TEXT,
  word_count          INTEGER,
  review              INTEGER DEFAULT 0, -- 0 = published, 1 = staging
  main_points         TEXT    DEFAULT '[]',
  application         TEXT    DEFAULT '[]',
  takeaways           TEXT    DEFAULT '[]',
  audience            TEXT    DEFAULT '[]',
  categories          TEXT    DEFAULT '[]',
  chunk_counts        TEXT    DEFAULT '{}',  -- {"transcript_section":N,"main_point":N,...}
  created_at          TEXT    DEFAULT (datetime('now')),
  updated_at          TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sermons_date    ON sermons(date);
CREATE INDEX IF NOT EXISTS idx_sermons_speaker ON sermons(speaker COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_sermons_series  ON sermons(series  COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_sermons_review  ON sermons(review);

-- Filterable child table: used by list_sermons (tag filter) and tag-scoped search
-- (resolved to sermon_id $in list for Vectorize filter).
CREATE TABLE IF NOT EXISTS sermon_tags (
  sermon_id TEXT NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  PRIMARY KEY (sermon_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_sermon_tags_tag ON sermon_tags(tag);

-- Filterable child table: used by find_by_scripture.
CREATE TABLE IF NOT EXISTS sermon_additional_scriptures (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sermon_id TEXT    NOT NULL REFERENCES sermons(id) ON DELETE CASCADE,
  ref       TEXT    NOT NULL,
  theme     TEXT
);

CREATE INDEX IF NOT EXISTS idx_additional_scriptures_sermon ON sermon_additional_scriptures(sermon_id);
CREATE INDEX IF NOT EXISTS idx_additional_scriptures_ref    ON sermon_additional_scriptures(ref COLLATE NOCASE);

-- Auth: one row per leader. Token is a long random string set manually via
-- wrangler d1 execute or the Cloudflare dashboard.
CREATE TABLE IF NOT EXISTS leader_tokens (
  token       TEXT PRIMARY KEY,
  leader_name TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  revoked     INTEGER DEFAULT 0  -- 0 = active, 1 = revoked
);
