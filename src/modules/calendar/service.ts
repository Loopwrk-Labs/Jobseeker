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
