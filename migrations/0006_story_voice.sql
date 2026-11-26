-- Voice-recorded STAR stories: the raw transcript is kept, and a story stays a
-- 'draft' until Claude (or Alex) turns it into Situation / Task / Action / Result.
ALTER TABLE stories ADD COLUMN raw TEXT;
ALTER TABLE stories ADD COLUMN status TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('draft', 'final'));
