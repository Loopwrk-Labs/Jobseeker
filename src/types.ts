export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AI?: Ai; // Workers AI (free daily allocation): speech-to-text for voice notes
}

export type Role = 'admin' | 'member';
export type Theme = 'auto' | 'light' | 'dark';

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  theme: Theme;
  leads_view: string | null;
}

export type JobStatus = 'review' | 'ready' | 'applied' | 'interview' | 'offer' | 'rejected';
export type JobLevel = 'head' | 'mid';
export type JobSource = 'agent' | 'manual' | 'gmail' | 'import';

export const STATUSES: JobStatus[] = ['review', 'ready', 'applied', 'interview', 'offer', 'rejected'];
export const STATUS_LABEL: Record<JobStatus, string> = {
  review: 'Za pregled',
  ready: 'Spremno za slanje',
  applied: 'Poslato',
  interview: 'Intervju',
  offer: 'Ponuda',
  rejected: 'Odbijeno',
};
export const STATUS_DESC: Record<JobStatus, string> = {
  review: 'Agent je našao i proverio oglas. Pogledaj da li ti odgovara.',
  ready: 'Paket za prijavu je spreman. Pregledaj ga i pošalji prijavu sam.',
  applied: 'Prijava je poslata. Čeka se odgovor.',
  interview: 'Pozvan si na razgovor ili test.',
  offer: 'Stigla je ponuda.',
  rejected: 'Odbijenica ili si odustao.',
};
/** Reuse Loopforce's stage colour tokens so the palette stays identical. */
export const STATUS_COLOR: Record<JobStatus, string> = {
  review: 'var(--stage-new)',
  ready: 'var(--stage-proposal)',
  applied: 'var(--stage-contacted)',
  interview: 'var(--stage-qualified)',
  offer: 'var(--stage-won)',
  rejected: 'var(--stage-lost)',
};
export const isStatus = (v: unknown): v is JobStatus => typeof v === 'string' && (STATUSES as string[]).includes(v);

export const LEVEL_LABEL: Record<JobLevel, string> = { head: 'Head/Senior', mid: 'Mid' };
export const isLevel = (v: unknown): v is JobLevel => v === 'head' || v === 'mid';

export const SOURCE_LABEL: Record<JobSource, string> = { agent: 'Agent', manual: 'Ručno', gmail: 'Gmail', import: 'Import' };
export const isSource = (v: unknown): v is JobSource => typeof v === 'string' && v in SOURCE_LABEL;

export interface JobRow {
  id: number;
  company: string;
  title: string;
  level: JobLevel;
  fit: number | null;
  status: JobStatus;
  location: string | null;
  contract_type: string | null;
  domain: string | null;
  url: string | null;
  risks: string | null;
  next_step: string | null;
  notes: string | null;
  source: JobSource;
  found_at: string;
  verified_at: string | null;
  applied_at: string | null;
  follow_up_on: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null; // EUR | USD | GBP | RSD
  salary_period: string | null; // month | year | hour
  salary_kind: string | null; // gross | net
  cv_version_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: number;
  job_id: number;
  actor: string;
  body: string;
  created_at: string;
}

export interface PackageRow {
  id: number;
  job_id: number;
  cover_letter: string | null;
  cv_bullets: string | null;
  answers: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExcludedRow {
  id: number;
  company: string;
  title: string | null;
  reason: string | null;
  url: string | null;
  created_at: string;
}

export interface RunRow {
  id: number;
  started_at: string;
  added: number;
  closed: number;
  updated: number;
  drafts: number;
  unverified: string | null;
  summary: string | null;
}

/** Days after applying until a follow-up is suggested. */
export const FOLLOW_UP_DAYS = 10;
