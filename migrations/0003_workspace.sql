-- Jobseeker v2: CV versions, STAR stories, answer library, interviews,
-- contacts, salary negotiation, push subscriptions.

CREATE TABLE cv_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,                 -- "Head of Delivery", "Mid PM", "Quickbase"
  focus       TEXT,                          -- when to use it (the agent reads this)
  content     TEXT,                          -- CV text (extracted from the PDF or pasted)
  file_name   TEXT,
  file_type   TEXT,
  file_data   BLOB,                          -- original PDF, ≤ 1.5 MB
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE jobs ADD COLUMN cv_version_id INTEGER REFERENCES cv_versions(id) ON DELETE SET NULL;

CREATE TABLE stories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  tags        TEXT,                          -- comma separated: leadership, conflict, delivery…
  situation   TEXT,
  task        TEXT,
  action      TEXT,
  result      TEXT,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','agent')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  tags        TEXT,
  job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  company     TEXT,                          -- kept when the job is deleted
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','agent')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE interviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  title         TEXT,                        -- "HR screen", "Final with CEO"
  starts_at     TEXT NOT NULL,               -- UTC ISO "2026-12-02T14:00:00Z"
  duration_min  INTEGER NOT NULL DEFAULT 45,
  location      TEXT,                        -- meeting link or address
  with_whom     TEXT,
  notes         TEXT,
  reminded_at   TEXT,                        -- push reminder sent
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','agent')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_interviews_start ON interviews(starts_at);

CREATE TABLE contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  role        TEXT,
  company     TEXT,
  email       TEXT,
  phone       TEXT,
  linkedin    TEXT,
  job_id      INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  notes       TEXT,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','agent')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE contact_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  channel     TEXT,                          -- email, call, linkedin, interview
  direction   TEXT,                          -- in | out
  summary     TEXT NOT NULL,
  actor       TEXT NOT NULL DEFAULT 'Alex'
);
CREATE INDEX idx_contact_events ON contact_events(contact_id, at);

CREATE TABLE salary_research (
  job_id          INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  market_min      REAL,
  market_max      REAL,
  market_currency TEXT,
  market_period   TEXT,                      -- month | year | hour
  market_sources  TEXT,                      -- Markdown list of links
  counter_amount  REAL,
  counter_text    TEXT,                      -- suggested counter-offer wording
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
