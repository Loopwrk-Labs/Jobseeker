import { Hono } from 'hono';
import type { Env, SessionUser, JobRow } from '../../types';
import { addEvent } from '../jobs/service';
import { fmtDate, parseDateInput } from '../../lib/format';
import { replyTemplate, STAGE_LABEL, type Stage } from './template';

type Vars = { user: SessionUser | null };
export const rejectionRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

export interface RejectionRow {
  id: number;
  job_id: number;
  received_on: string | null;
  from_name: string | null;
  from_email: string | null;
  stage: Stage;
  message: string | null;
  generic: number;
  reason: string | null;
  reply: string | null;
  reply_status: 'none' | 'draft' | 'sent' | 'skip';
  source: 'manual' | 'agent';
  updated_at: string;
}

export const REPLY_STATUS_LABEL: Record<RejectionRow['reply_status'], string> = {
  none: 'Nije odgovoreno',
  draft: 'Draft u Gmailu',
  sent: 'Poslato',
  skip: 'Ne odgovaram',
};

export async function getRejection(db: D1Database, jobId: number): Promise<RejectionRow | null> {
  return db.prepare('SELECT * FROM rejections WHERE job_id = ?').bind(jobId).first<RejectionRow>();
}

const STAGES: Stage[] = ['application', 'interview', 'final'];
const isStage = (v: unknown): v is Stage => STAGES.includes(v as Stage);
const s = (v: unknown) => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};

/** Shown on the job's overview tab once the job is rejected (or a rejection is on file). */
export function RejectionPanel({ job, r, rounds }: { job: JobRow; r: RejectionRow | null; rounds: number }) {
  const stage: Stage = r?.stage ?? (rounds > 0 ? 'interview' : 'application');
  const generic = r ? r.generic === 1 : true;
  const reply = r?.reply ?? replyTemplate({ name: r?.from_name, title: job.title, stage, rounds, generic });
  return (
    <div class="panel rej" id="odbijenica">
      <div class="panel-head">
        <h3>Odbijenica</h3>
        {r && <span class={`rej-st rej-${r.reply_status}`}>{REPLY_STATUS_LABEL[r.reply_status]}</span>}
      </div>

      {r ? (
        <div class="rej-meta">
          <span class={`rej-badge ${generic ? 'gen' : 'spec'}`}>{generic ? 'Generička' : 'Konkretan razlog'}</span>
          <span>{STAGE_LABEL[r.stage]}</span>
          {r.received_on && <span class="mono">{fmtDate(r.received_on)}</span>}
          {(r.from_name || r.from_email) && <span>{r.from_name ?? ''}{r.from_email ? ` · ${r.from_email}` : ''}</span>}
        </div>
      ) : (
        <div class="faint" style="font-size:.86rem;margin-bottom:10px">
          Odbijenica još nije zabeležena. Agent je upisuje iz Gmaila, a možeš i ti ispod. Odgovor je već pripremljen po šablonu.
        </div>
      )}
      {r?.reason && <div class="rej-reason"><div class="k">Razlog koji su naveli</div><div>{r.reason}</div></div>}
      {r?.message && (
        <details class="rej-msg">
          <summary>Njihova poruka</summary>
          <div class="prewrap">{r.message}</div>
        </details>
      )}

      <form method="post" action={`/jobs/${job.id}/rejection`} class="rej-form">
        <label class="k" for="rej-reply">Tvoj odgovor (engleski, direktan ton)</label>
        <textarea id="rej-reply" name="reply" rows={12}>{reply}</textarea>
        <div class="inline-actions" style="margin-top:8px">
          <button type="button" class="btn btn-solid btn-sm" data-copy="rej-reply">Kopiraj odgovor</button>
          <button type="submit" class="btn btn-line btn-sm">Sačuvaj</button>
          <button type="submit" class="btn btn-line btn-sm" formaction={`/jobs/${job.id}/rejection/template`}>Vrati šablon</button>
        </div>

        <details class="rej-edit" open={!r}>
          <summary>Detalji odbijenice</summary>
          <div class="form-grid three" style="margin-top:10px">
            <label><span class="k">Primljeno</span><input name="received_on" type="date" value={r?.received_on ?? ''} /></label>
            <label><span class="k">Ko je poslao</span><input name="from_name" value={r?.from_name ?? ''} placeholder="Ime" /></label>
            <label><span class="k">Email</span><input name="from_email" type="email" value={r?.from_email ?? ''} /></label>
            <label><span class="k">Faza</span>
              <select name="stage">{STAGES.map((x) => <option value={x} selected={x === stage}>{STAGE_LABEL[x]}</option>)}</select>
            </label>
            <label><span class="k">Vrsta</span>
              <select name="generic"><option value="1" selected={generic}>Generička</option><option value="0" selected={!generic}>Konkretan razlog</option></select>
            </label>
            <label><span class="k">Status odgovora</span>
              <select name="reply_status">{(['none', 'draft', 'sent', 'skip'] as const).map((x) => <option value={x} selected={(r?.reply_status ?? 'none') === x}>{REPLY_STATUS_LABEL[x]}</option>)}</select>
            </label>
          </div>
          <label style="display:block;margin-top:8px"><span class="k">Razlog koji su naveli (ako postoji)</span><input name="reason" value={r?.reason ?? ''} /></label>
          <label style="display:block;margin-top:8px"><span class="k">Njihova poruka</span><textarea name="message" rows={4}>{r?.message ?? ''}</textarea></label>
        </details>
      </form>
      <div class="faint" style="font-size:.78rem;margin-top:8px">Ništa se ne šalje samo. Agent pravi samo Gmail draft u istoj niti, a šalješ ti.</div>
    </div>
  );
}

async function upsert(db: D1Database, jobId: number, f: Record<string, unknown>, keepReply = true) {
  const stage = isStage(f.stage) ? f.stage : 'application';
  const status = ['none', 'draft', 'sent', 'skip'].includes(String(f.reply_status)) ? String(f.reply_status) : 'none';
  await db
    .prepare(
      `INSERT INTO rejections (job_id, received_on, from_name, from_email, stage, message, generic, reason, reply, reply_status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
       ON CONFLICT(job_id) DO UPDATE SET received_on=excluded.received_on, from_name=excluded.from_name, from_email=excluded.from_email,
         stage=excluded.stage, message=excluded.message, generic=excluded.generic, reason=excluded.reason,
         reply=${keepReply ? 'excluded.reply' : 'rejections.reply'}, reply_status=excluded.reply_status, updated_at=datetime('now')`,
    )
    .bind(jobId, parseDateInput(f.received_on), s(f.from_name), s(f.from_email), stage, s(f.message), f.generic === '0' ? 0 : 1, s(f.reason), s(f.reply), status)
    .run();
}

rejectionRoutes.post('/jobs/:id/rejection', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const job = await c.env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(id).first();
  if (!job) return c.redirect('/jobs');
  const before = await getRejection(c.env.DB, id);
  const b = await c.req.parseBody();
  await upsert(c.env.DB, id, b);
  if (!before) await addEvent(c.env.DB, id, user.name, 'Zabeležena odbijenica.');
  else if (before.reply_status !== b.reply_status && b.reply_status === 'sent') await addEvent(c.env.DB, id, user.name, 'Odgovor na odbijenicu poslat.');
  return c.redirect(`/jobs/${id}?ok=rej#odbijenica`);
});

// Replace the reply with a fresh template (keeps every other field as typed in the form).
rejectionRoutes.post('/jobs/:id/rejection/template', async (c) => {
  const id = Number(c.req.param('id'));
  const job = await c.env.DB.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
  if (!job) return c.redirect('/jobs');
  const b = await c.req.parseBody();
  const rounds = (await c.env.DB.prepare("SELECT COUNT(*) n FROM interviews WHERE job_id = ? AND starts_at <= datetime('now')").bind(id).first<{ n: number }>())?.n ?? 0;
  const stage = isStage(b.stage) ? b.stage : rounds > 0 ? 'interview' : 'application';
  const reply = replyTemplate({ name: s(b.from_name), title: job.title, stage, rounds, generic: b.generic !== '0' });
  await upsert(c.env.DB, id, { ...b, reply });
  return c.redirect(`/jobs/${id}?ok=rejtpl#odbijenica`);
});
