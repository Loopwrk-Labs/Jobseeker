-- Salary the employer states in the posting (filled by the agent only when the
-- posting itself gives a number; never from aggregator estimates).
ALTER TABLE jobs ADD COLUMN salary_min REAL;
ALTER TABLE jobs ADD COLUMN salary_max REAL;
ALTER TABLE jobs ADD COLUMN salary_currency TEXT;  -- EUR | USD | GBP | RSD
ALTER TABLE jobs ADD COLUMN salary_period TEXT;    -- month | year | hour
ALTER TABLE jobs ADD COLUMN salary_kind TEXT;      -- gross | net
