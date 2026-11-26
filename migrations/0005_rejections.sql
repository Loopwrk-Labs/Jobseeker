-- Rejections: what the company sent, whether it was generic, and Alex's reply.
-- One per job. The agent fills it from Gmail; the reply is only ever a Gmail DRAFT.
CREATE TABLE rejections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  received_on   TEXT,
  from_name     TEXT,
  from_email    TEXT,
  stage         TEXT NOT NULL DEFAULT 'application' CHECK (stage IN ('application', 'interview', 'final')),
  message       TEXT,
  generic       INTEGER NOT NULL DEFAULT 1 CHECK (generic IN (0, 1)),
  reason        TEXT,
  reply         TEXT,
  reply_status  TEXT NOT NULL DEFAULT 'none' CHECK (reply_status IN ('none', 'draft', 'sent', 'skip')),
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'agent')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rejections_status ON rejections(reply_status);
