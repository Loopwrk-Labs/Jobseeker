import type { JobRow, JobStatus, EventRow, PackageRow, JobLevel, JobSource } from '../../types';
import { STATUS_LABEL, FOLLOW_UP_DAYS } from '../../types';
import { addDaysISO, todayISO } from '../../lib/format';

export interface JobFilter {
  status?: JobStatus[];
  level?: JobLevel;
  q?: string;
  sort?: 'fit' | 'found' | 'updated' | 'company';
}

export async function listJobs(db: D1Database, f: JobFilter = {}): Promise<JobRow[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status && f.status.length) {
    where.push(`status IN (${f.status.map(() => '?').join(',')})`);
    args.push(...f.status);
  }
  if (f.level) {
    where.push('level = ?');
    args.push(f.level);
  }
  if (f.q) {
    where.push('(company LIKE ? OR title LIKE ? OR domain LIKE ?)');
    const like = `%${f.q}%`;
    args.push(like, like, like);
  }
  const order =
    f.sort === 'found'
      ? 'found_at DESC, id DESC'
      : f.sort === 'updated'
      ? 'updated_at DESC'
      : f.sort === 'company'
      ? 'company COLLATE NOCASE ASC'
      : 'COALESCE(fit,0) DESC, found_at DESC';
  const sql = `SELECT * FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`;
  const { results } = await db.prepare(sql).bind(...args).all<JobRow>();
  return results ?? [];
}

export async function getJob(db: D1Database, id: number): Promise<JobRow | null> {
  return (await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>()) ?? null;
}

export async function statusCounts(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all<{ status: string; n: number }>();
  const out: Record<string, number> = {};
  for (const r of results ?? []) out[r.status] = r.n;
  return out;
}

export async function followUpsDue(db: D1Database): Promise<JobRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM jobs WHERE status = 'applied' AND follow_up_on IS NOT NULL AND follow_up_on <= ? ORDER BY follow_up_on ASC")
    .bind(todayISO())
    .all<JobRow>();
  return results ?? [];
}

export interface JobInput {
  company: string;
  title: string;
  level: JobLevel;
  fit: number | null;
  location: string | null;
  contract_type: string | null;
  domain: string | null;
  url: string | null;
  risks: string | null;
  next_step: string | null;
  notes: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  salary_kind: string | null;
}

export async function createJob(db: D1Database, input: JobInput, source: JobSource, actor: string): Promise<number> {
  const r = await db
    .prepare(
      `INSERT INTO jobs (company, title, level, fit, location, contract_type, domain, url, risks, next_step, notes, source,
         salary_min, salary_max, salary_currency, salary_period, salary_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(input.company, input.title, input.level, input.fit, input.location, input.contract_type, input.domain, input.url, input.risks, input.next_step, input.notes, source,
      input.salary_min, input.salary_max, input.salary_currency, input.salary_period, input.salary_kind)
    .run();
  const id = r.meta.last_row_id as number;
  await addEvent(db, id, actor, 'Posao dodat ručno.');
  return id;
}

export async function updateJob(db: D1Database, id: number, input: JobInput, actor: string): Promise<void> {
  const before = await getJob(db, id);
  if (!before) return;
  await db
    .prepare(
      `UPDATE jobs SET company=?, title=?, level=?, fit=?, location=?, contract_type=?, domain=?, url=?, risks=?, next_step=?, notes=?,
         salary_min=?, salary_max=?, salary_currency=?, salary_period=?, salary_kind=?, updated_at=datetime('now') WHERE id=?`,
    )
    .bind(input.company, input.title, input.level, input.fit, input.location, input.contract_type, input.domain, input.url, input.risks, input.next_step, input.notes,
      input.salary_min, input.salary_max, input.salary_currency, input.salary_period, input.salary_kind, id)
    .run();
  const labels: Record<string, string> = { company: 'Firma', title: 'Pozicija', level: 'Nivo', fit: 'Fit', location: 'Lokacija', contract_type: 'Ugovor', domain: 'Domen', url: 'Link', salary_min: 'Plata od', salary_max: 'Plata do', salary_currency: 'Valuta plate' };
  const changes: string[] = [];
  for (const k of Object.keys(labels) as (keyof JobInput)[]) {
    const a = (before as any)[k] ?? '';
    const b = (input as any)[k] ?? '';
    if (String(a) !== String(b)) changes.push(`${labels[k]}: ${a || '—'} → ${b || '—'}`);
  }
  if (changes.length) await addEvent(db, id, actor, changes.join('\n'));
}

export async function setStatus(db: D1Database, id: number, status: JobStatus, actor: string): Promise<void> {
  const job = await getJob(db, id);
  if (!job || job.status === status) return;
  const today = todayISO();
  if (status === 'applied') {
    await db
      .prepare("UPDATE jobs SET status=?, applied_at=COALESCE(applied_at, ?), follow_up_on=COALESCE(follow_up_on, ?), updated_at=datetime('now') WHERE id=?")
      .bind(status, today, addDaysISO(today, FOLLOW_UP_DAYS), id)
      .run();
  } else {
    await db.prepare("UPDATE jobs SET status=?, updated_at=datetime('now') WHERE id=?").bind(status, id).run();
  }
  await addEvent(db, id, actor, `Status: ${STATUS_LABEL[job.status]} → ${STATUS_LABEL[status]}`);
}

export async function setFollowUp(db: D1Database, id: number, date: string | null, actor: string): Promise<void> {
  await db.prepare("UPDATE jobs SET follow_up_on=?, updated_at=datetime('now') WHERE id=?").bind(date, id).run();
  await addEvent(db, id, actor, date ? `Follow-up zakazan za ${date.split('-').reverse().join('.')}.` : 'Follow-up uklonjen.');
}

export async function addEvent(db: D1Database, jobId: number, actor: string, body: string): Promise<void> {
  await db.prepare('INSERT INTO job_events (job_id, actor, body) VALUES (?, ?, ?)').bind(jobId, actor, body).run();
}

export async function listEvents(db: D1Database, jobId: number): Promise<EventRow[]> {
  const { results } = await db.prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at DESC, id DESC').bind(jobId).all<EventRow>();
  return results ?? [];
}

export async function getPackage(db: D1Database, jobId: number): Promise<PackageRow | null> {
  return (await db.prepare('SELECT * FROM packages WHERE job_id = ? ORDER BY updated_at DESC LIMIT 1').bind(jobId).first<PackageRow>()) ?? null;
}

export async function savePackage(
  db: D1Database,
  jobId: number,
  p: { cover_letter: string | null; cv_bullets: string | null; answers: string | null },
  actor: string,
): Promise<void> {
  const existing = await getPackage(db, jobId);
  if (existing) {
    await db
      .prepare("UPDATE packages SET cover_letter=?, cv_bullets=?, answers=?, updated_at=datetime('now') WHERE id=?")
      .bind(p.cover_letter, p.cv_bullets, p.answers, existing.id)
      .run();
  } else {
    await db.prepare('INSERT INTO packages (job_id, cover_letter, cv_bullets, answers) VALUES (?, ?, ?, ?)').bind(jobId, p.cover_letter, p.cv_bullets, p.answers).run();
  }
  await addEvent(db, jobId, actor, 'Paket za prijavu izmenjen.');
}

/** Removes the job and remembers it so the agent never brings it back. */
export async function excludeJob(db: D1Database, id: number, reason: string | null): Promise<void> {
  const job = await getJob(db, id);
  if (!job) return;
  await db.batch([
    db.prepare('INSERT INTO excluded (company, title, reason, url) VALUES (?, ?, ?, ?)').bind(job.company, job.title, reason, job.url),
    db.prepare('DELETE FROM jobs WHERE id = ?').bind(id),
  ]);
}

export async function deleteJob(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM jobs WHERE id = ?').bind(id).run();
}
