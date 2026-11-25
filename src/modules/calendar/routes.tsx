import { Hono } from 'hono';
import type { Env, SessionUser } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { Flash, safeUrl } from '../../views/helpers';
import { localToUtc, utcToLocal, fmtWhen } from '../../lib/tz';
import { upcomingInterviews, pastInterviews, icsToken, buildIcs, allInterviews, type InterviewRow } from './service';

type Vars = { user: SessionUser | null };
export const calendarRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const s = (v: unknown) => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};

export function InterviewItem({ r, showJob = true, back }: { r: InterviewRow; showJob?: boolean; back: string }) {
  const link = r.location && safeUrl(r.location);
  return (
    <div class="iv">
      <div class="iv-when mono">{fmtWhen(r.starts_at)}<span class="faint"> · {r.duration_min} min</span></div>
      <div class="iv-body">
        <div class="iv-title">
          {r.title || 'Intervju'}
          {showJob && r.job_id && <> · <a href={`/jobs/${r.job_id}`}>{r.company}</a></>}
        </div>
        <div class="faint" style="font-size:.84rem">
          {[r.with_whom, showJob ? r.job_title : null].filter(Boolean).join(' · ')}
          {link ? <> · <a href={link} target="_blank" rel="noopener noreferrer">link za poziv ↗</a></> : r.location ? ` · ${r.location}` : ''}
        </div>
        {r.notes && <div class="prewrap" style="font-size:.84rem;margin-top:4px">{r.notes}</div>}
      </div>
      <div class="iv-actions">
        <details class="iv-edit">
          <summary class="btn btn-line btn-sm">Izmeni</summary>
          <InterviewForm r={r} back={back} />
        </details>
        <form method="post" action={`/interviews/${r.id}/delete`} onsubmit="return confirm('Obrisati intervju?')">
          <input type="hidden" name="back" value={back} />
          <button class="btn btn-line btn-sm" type="submit">Obriši</button>
        </form>
      </div>
    </div>
  );
}

export function InterviewForm({ r, jobId, jobs, back }: { r?: InterviewRow; jobId?: number; jobs?: { id: number; company: string; title: string }[]; back: string }) {
  return (
    <form method="post" action={r ? `/interviews/${r.id}` : '/interviews'} class="iv-form">
      <input type="hidden" name="back" value={back} />
      {jobs ? (
        <div class="field">
          <label>Posao *</label>
          <select name="job_id" required>
            <option value="">Izaberi…</option>
            {jobs.map((j) => <option value={j.id}>{j.company} · {j.title}</option>)}
          </select>
        </div>
      ) : (
        <input type="hidden" name="job_id" value={r?.job_id ?? jobId ?? ''} />
      )}
      <div class="form-grid four">
        <div class="field"><label>Naziv</label><input name="title" placeholder="HR screen, tehnički, finalni…" value={r?.title ?? ''} /></div>
        <div class="field"><label>Početak (Beograd) *</label><input type="datetime-local" name="starts_at" required value={utcToLocal(r?.starts_at)} /></div>
        <div class="field"><label>Trajanje, min</label><input name="duration_min" inputmode="numeric" value={r?.duration_min ?? 45} /></div>
        <div class="field"><label>Sa kim</label><input name="with_whom" value={r?.with_whom ?? ''} /></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Link ili adresa</label><input name="location" placeholder="https://meet.google.com/…" value={r?.location ?? ''} /></div>
        <div class="field"><label>Beleške</label><input name="notes" value={r?.notes ?? ''} /></div>
      </div>
      <div class="form-actions"><button type="submit" class="btn btn-solid btn-sm">Sačuvaj intervju</button></div>
    </form>
  );
}

calendarRoutes.get('/calendar', async (c) => {
  const user = c.get('user') as SessionUser;
  const [up, past, token, jobsRes] = await Promise.all([
    upcomingInterviews(c.env.DB),
    pastInterviews(c.env.DB, 30),
    icsToken(c.env.DB),
    c.env.DB.prepare("SELECT id, company, title FROM jobs WHERE status IN ('applied','interview','offer','ready','review') ORDER BY status = 'interview' DESC, company").all<{ id: number; company: string; title: string }>(),
  ]);
  const origin = new URL(c.req.url).origin;
  const feed = `${origin}/calendar.ics?t=${token}`;
  const ok = c.req.query('ok');
  return c.html(
    <Layout title="Kalendar" active="calendar" user={user}>
      <Topbar crumb={<b>Kalendar intervjua</b>} />
      <div class="content" style="max-width:1000px">
        {ok && <Flash>{ok === 'del' ? 'Intervju je obrisan.' : 'Intervju je sačuvan.'}</Flash>}
        <div class="page-head">
          <div>
            <h1>Kalendar</h1>
            <div class="sub">{up.length} predstojećih intervjua. Podsetnik stiže 1 dan i 1 sat pre početka.</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Predstojeći</h3></div>
          {up.length === 0 && <div class="faint" style="font-size:.88rem">Nema zakazanih intervjua. Agent ih upisuje sam kad stigne poziv na mejl, a možeš i ručno ispod.</div>}
          {up.map((r) => <InterviewItem r={r} back="/calendar" />)}
        </div>

        <details class="panel" open={up.length === 0}>
          <summary class="panel-sum">+ Dodaj intervju</summary>
          <div style="margin-top:12px"><InterviewForm jobs={jobsRes.results ?? []} back="/calendar" /></div>
        </details>

        <div class="panel">
          <div class="panel-head"><h3>Google Calendar</h3></div>
          <ol class="steps-ol">
            <li>Kopiraj link ispod.</li>
            <li>U Google Calendar na računaru: <b>Other calendars → + → From URL</b>, nalepi link i klikni <b>Add calendar</b>.</li>
            <li>Intervjui se pojavljuju sami. Google osvežava ovakav kalendar na nekoliko sati, pa za hitne izmene gledaj ovde.</li>
          </ol>
          <div class="ics-row">
            <input readonly value={feed} id="icsUrl" onclick="this.select()" />
            <button type="button" class="btn btn-solid btn-sm" data-copy-text={feed}>Kopiraj link</button>
          </div>
          <div class="faint" style="font-size:.78rem;margin-top:6px">Link je tajan: ko ga ima, vidi tvoje intervjue. Za iPhone: Settings → Calendar → Accounts → Add Subscribed Calendar.</div>
        </div>

        {past.length > 0 && (
          <div class="panel">
            <div class="panel-head"><h3>Prošli</h3></div>
            {past.map((r) => <InterviewItem r={r} back="/calendar" />)}
          </div>
        )}
      </div>
    </Layout>,
  );
});

async function saveInterview(c: any, id: number | null) {
  const b = await c.req.parseBody();
  const back = s(b.back);
  const startsAt = localToUtc(String(b.starts_at ?? ''));
  const jobId = Number(b.job_id) || null;
  const target = back && back.startsWith('/') ? back : '/calendar';
  if (!startsAt) return c.redirect(target);
  const dur = Math.max(5, Math.min(600, Number(b.duration_min) || 45));
  const vals = [jobId, s(b.title), startsAt, dur, s(b.location), s(b.with_whom), s(b.notes)];
  const db: D1Database = c.env.DB;
  if (id) await db.prepare(`UPDATE interviews SET job_id=?, title=?, starts_at=?, duration_min=?, location=?, with_whom=?, notes=?, reminded_at=NULL, updated_at=datetime('now') WHERE id=?`).bind(...vals, id).run();
  else {
    await db.prepare('INSERT INTO interviews (job_id, title, starts_at, duration_min, location, with_whom, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(...vals).run();
    if (jobId) {
      await db.prepare(`UPDATE jobs SET status='interview', updated_at=datetime('now') WHERE id=? AND status IN ('review','ready','applied')`).bind(jobId).run();
      await db.prepare("INSERT INTO job_events (job_id, actor, body) VALUES (?, ?, ?)").bind(jobId, c.get('user')?.name ?? 'Alex', `Zakazan intervju: ${s(b.title) ?? 'Intervju'}, ${fmtWhen(startsAt)}`).run();
    }
  }
  return c.redirect(target + (target.includes('?') ? '&' : '?') + 'ok=iv');
}
calendarRoutes.post('/interviews', (c) => saveInterview(c, null));
calendarRoutes.post('/interviews/:id', (c) => saveInterview(c, Number(c.req.param('id'))));
calendarRoutes.post('/interviews/:id/delete', async (c) => {
  const b = await c.req.parseBody();
  await c.env.DB.prepare('DELETE FROM interviews WHERE id = ?').bind(Number(c.req.param('id'))).run();
  const back = s(b.back);
  return c.redirect(back && back.startsWith('/') ? back : '/calendar?ok=del');
});

/** Public, token-protected iCalendar feed for Google/Apple Calendar. */
calendarRoutes.get('/calendar.ics', async (c) => {
  const t = c.req.query('t') ?? '';
  const token = await icsToken(c.env.DB);
  if (!t || t.length !== token.length || t !== token) return c.text('Not found', 404);
  const rows = await allInterviews(c.env.DB);
  return new Response(buildIcs(rows, new URL(c.req.url).origin), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'content-disposition': 'inline; filename="jobseeker.ics"' },
  });
});
