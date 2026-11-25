-- Candidate → interviewer feedback, and meeting recordings (Fathom).
CREATE TABLE interview_feedback (
  interview_id  INTEGER PRIMARY KEY REFERENCES interviews(id) ON DELETE CASCADE,
  feeling       INTEGER,            -- 1 (loše) … 5 (odlično)
  feeling_text  TEXT,
  r_respect     INTEGER,            -- 1–5 ratings of the interviewer/process
  r_prep        INTEGER,
  r_clarity     INTEGER,
  r_time        INTEGER,
  r_comms       INTEGER,
  red_flags     TEXT,
  would_work    TEXT,               -- yes | maybe | no
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recordings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL DEFAULT 'fathom',
  external_id   TEXT NOT NULL UNIQUE,
  title         TEXT,
  started_at    TEXT,               -- UTC ISO
  ended_at      TEXT,
  url           TEXT,
  share_url     TEXT,
  invitees      TEXT,               -- "Name <email>, …"
  summary       TEXT,               -- Markdown
  action_items  TEXT,               -- Markdown list
  transcript    TEXT,               -- "[00:01:02] Name: text" lines
  analysis      TEXT,               -- Claude's review (Markdown)
  interview_id  INTEGER REFERENCES interviews(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_recordings_interview ON recordings(interview_id);

ALTER TABLE interviews ADD COLUMN feedback_asked_at TEXT;
