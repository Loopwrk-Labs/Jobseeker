export interface InterviewRow {
  id: number;
  job_id: number | null;
  title: string | null;
  starts_at: string;
  duration_min: number;
  location: string | null;
  with_whom: string | null;
  notes: string | null;
  reminded_at: string | null;
  source: string;
  company?: string | null;
  job_title?: string | null;
}

const SELECT = `SELECT i.*, j.company AS company, j.title AS job_title FROM interviews i LEFT JOIN jobs j ON j.id = i.job_id`;

export async function upcomingInterviews(db: D1Database, limit = 50): Promise<InterviewRow[]> {
  const now = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const { results } = await db.prepare(`${SELECT} WHERE i.starts_at >= ? ORDER BY i.starts_at LIMIT ?`).bind(now, limit).all<InterviewRow>();
  return results ?? [];
}

export async function pastInterviews(db: D1Database, limit = 50): Promise<InterviewRow[]> {
  const now = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const { results } = await db.prepare(`${SELECT} WHERE i.starts_at < ? ORDER BY i.starts_at DESC LIMIT ?`).bind(now, limit).all<InterviewRow>();
  return results ?? [];
}

export async function jobInterviews(db: D1Database, jobId: number): Promise<InterviewRow[]> {
  const { results } = await db.prepare(`${SELECT} WHERE i.job_id = ? ORDER BY i.starts_at`).bind(jobId).all<InterviewRow>();
  return results ?? [];
}

export async function allInterviews(db: D1Database): Promise<InterviewRow[]> {
  const { results } = await db.prepare(`${SELECT} ORDER BY i.starts_at DESC LIMIT 500`).all<InterviewRow>();
  return results ?? [];
}

/** Secret token for the read-only calendar feed, created on first use. */
export async function icsToken(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = 'ics_token'").first<{ value: string }>();
  if (row?.value) return row.value;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const t = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  await db.prepare("INSERT INTO app_settings (key, value) VALUES ('ics_token', ?) ON CONFLICT(key) DO NOTHING").bind(t).run();
  const again = await db.prepare("SELECT value FROM app_settings WHERE key = 'ics_token'").first<{ value: string }>();
  return again?.value ?? t;
}

function icsEsc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
}
function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 74) {
    let n = 74;
    while (new TextEncoder().encode(rest.slice(0, n)).length > 74) n--;
    out.push(rest.slice(0, n));
    rest = ' ' + rest.slice(n);
  }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(rows: InterviewRow[], origin: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jobseeker//Intervjui//SR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Jobseeker intervjui', 'X-PUBLISHED-TTL:PT1H'];
  const stamp = icsDate(new Date().toISOString());
  for (const r of rows) {
    const end = new Date(new Date(r.starts_at).getTime() + (r.duration_min || 45) * 60000).toISOString();
    const summary = `${r.title || 'Intervju'}${r.company ? ` · ${r.company}` : ''}`;
    const desc = [r.job_title ? `Pozicija: ${r.job_title}` : null, r.with_whom ? `Sa: ${r.with_whom}` : null, r.notes, r.job_id ? `${origin}/jobs/${r.job_id}` : null].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:interview-${r.id}@jobseeker`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(r.starts_at)}`,
      `DTEND:${icsDate(end)}`,
      fold(`SUMMARY:${icsEsc(summary)}`),
      ...(desc ? [fold(`DESCRIPTION:${icsEsc(desc)}`)] : []),
      ...(r.location ? [fold(`LOCATION:${icsEsc(r.location)}`)] : []),
      ...(r.location && /^https?:\/\//.test(r.location) ? [fold(`URL:${r.location}`)] : []),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT1H', fold(`DESCRIPTION:${icsEsc(summary)} za 1 h`), 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', fold(`DESCRIPTION:Sutra: ${icsEsc(summary)}`), 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export interface FeedbackRow {
  interview_id: number;
  feeling: number | null;
  feeling_text: string | null;
  r_respect: number | null;
  r_prep: number | null;
  r_clarity: number | null;
  r_time: number | null;
  r_comms: number | null;
  red_flags: string | null;
  would_work: string | null;
  notes: string | null;
}
export interface RecordingRow {
  id: number;
  external_id: string;
  title: string | null;
  started_at: string | null;
  url: string | null;
  share_url: string | null;
  invitees: string | null;
  summary: string | null;
  action_items: string | null;
  transcript: string | null;
  analysis: string | null;
  interview_id: number | null;
}

export async function extrasFor(db: D1Database, ids: number[]): Promise<{ fb: Map<number, FeedbackRow>; rec: Map<number, RecordingRow> }> {
  const fb = new Map<number, FeedbackRow>();
  const rec = new Map<number, RecordingRow>();
  if (!ids.length) return { fb, rec };
  const q = ids.map(() => '?').join(',');
  const [a, b] = await Promise.all([
    db.prepare(`SELECT * FROM interview_feedback WHERE interview_id IN (${q})`).bind(...ids).all<FeedbackRow>(),
    db.prepare(`SELECT * FROM recordings WHERE interview_id IN (${q}) ORDER BY id`).bind(...ids).all<RecordingRow>(),
  ]);
  for (const r of a.results ?? []) fb.set(r.interview_id, r);
  for (const r of b.results ?? []) if (r.interview_id) rec.set(r.interview_id, r);
  return { fb, rec };
}

export const RATINGS: [keyof FeedbackRow, string][] = [
  ['r_respect', 'Poštovanje i odnos'],
  ['r_prep', 'Pripremljenost intervjuera'],
  ['r_clarity', 'Jasnoća uloge i procesa'],
  ['r_time', 'Tačnost i poštovanje vremena'],
  ['r_comms', 'Komunikacija posle'],
];
export const FEELINGS = ['', '😣 Loše', '😕 Nelagodno', '😐 Neutralno', '🙂 Dobro', '😄 Odlično'];

export function avgRating(f: FeedbackRow | null | undefined): number | null {
  if (!f) return null;
  const v = RATINGS.map(([k]) => f[k] as number | null).filter((x): x is number => typeof x === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}
