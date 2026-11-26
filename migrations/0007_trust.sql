-- Legitimacy check for a job ad / employer: set by the agent (or Alex) after checking
-- the company exists, the recruiter's domain, and scam signals.
ALTER TABLE jobs ADD COLUMN trust TEXT CHECK (trust IN ('ok', 'caution', 'scam'));
ALTER TABLE jobs ADD COLUMN trust_notes TEXT;
ALTER TABLE jobs ADD COLUMN trust_checked_at TEXT;
