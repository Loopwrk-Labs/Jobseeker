-- Jobseeker v1 schema
-- The morning agent (a Claude scheduled task) writes to this database directly
-- through the Cloudflare D1 connector, the same way Loopforce's lead agents do.

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_seen_at    TEXT,
  theme           TEXT NOT NULL DEFAULT 'auto',
  leads_view      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- One row per job posting.
CREATE TABLE jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company       TEXT NOT NULL,
  title         TEXT NOT NULL,
  level         TEXT NOT NULL DEFAULT 'head' CHECK (level IN ('head', 'mid')),
  fit           INTEGER CHECK (fit BETWEEN 1 AND 10),
  status        TEXT NOT NULL DEFAULT 'review'
                CHECK (status IN ('review', 'ready', 'applied', 'interview', 'offer', 'rejected')),
  location      TEXT,
  contract_type TEXT,          -- employee / contractor / B2B / part-time / free text
  domain        TEXT,          -- e.g. fintech, payments, hospitality tech
  url           TEXT,          -- ORIGINAL employer / ATS link, never an aggregator
  risks         TEXT,          -- "Zašto / rizici"
  next_step     TEXT,          -- "Sledeći korak"
  notes         TEXT,          -- Alex's own notes
  source        TEXT NOT NULL DEFAULT 'agent' CHECK (source IN ('agent', 'manual', 'gmail', 'import')),
  found_at      TEXT NOT NULL DEFAULT (date('now')),
  verified_at   TEXT,          -- last time the posting was confirmed open on the employer's page
  applied_at    TEXT,
  follow_up_on  TEXT,          -- date a follow-up is due
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_company ON jobs(company);

-- Append-only log per job: status changes, agent actions, notes.
CREATE TABLE job_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  actor      TEXT NOT NULL DEFAULT 'agent', -- 'agent' or the user's name
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_job ON job_events(job_id);

-- Application packages the agent prepares: cover letter + tailored CV bullets.
CREATE TABLE packages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id       INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cover_letter TEXT,
  cv_bullets   TEXT,
  answers      TEXT,  -- drafted answers to application-form questions
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_packages_job ON packages(job_id);

-- Postings the agent must never bring back (removed by Alex, closed, not eligible).
CREATE TABLE excluded (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company    TEXT NOT NULL,
  title      TEXT,            -- NULL = the whole company is excluded
  reason     TEXT,
  url        TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_excluded_company ON excluded(company);

-- One row per agent run, with the summary it sent.
CREATE TABLE agent_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  added       INTEGER NOT NULL DEFAULT 0,
  closed      INTEGER NOT NULL DEFAULT 0,
  updated     INTEGER NOT NULL DEFAULT 0,
  drafts      INTEGER NOT NULL DEFAULT 0,
  unverified  TEXT,           -- "Nisam mogao da proverim" list (Markdown)
  summary     TEXT            -- Markdown
);

-- Key/value: 'profile' (CV summary the agent uses), 'criteria' (search rules mirror).
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
