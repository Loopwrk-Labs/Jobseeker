import { Hono } from 'hono';
import type { Env, SessionUser } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { Flash, safeUrl } from '../../views/helpers';
import { localToUtc, utcToLocal, fmtWhen } from '../../lib/tz';
import { upcomingInterviews, pastInterviews, icsToken, buildIcs, allInterviews, extrasFor, avgRating, RATINGS, FEELINGS, type InterviewRow, type FeedbackRow, type RecordingRow } from './service';
import { raw } from 'hono/html';
import { renderMarkdown } from '../../lib/markdown';
import { AskClaude, PROMPTS } from '../../lib/claude';
import { getConfig } from '../fathom/service';
import { fmtDateTime } from '../../views/helpers';

type Vars = { user: SessionUser | null };
export const calendarRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const s = (v: unknown) => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};

export function InterviewItem({ r, showJob = true, back, fb, rec }: { r: InterviewRow; showJob?: boolean; back: string; fb?: FeedbackRow; rec?: RecordingRow }) {
  const link = r.location && safeUrl(r.location);
  const started = new Date(r.starts_at).getTime() < Date.now();
  return (
    <div class="iv" id={`fb-${r.id}`}>
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
        {(started || fb) && <FeedbackBlock r={r} fb={fb} back={back} />}
        {rec && <RecordingBlock r={r} rec={rec} />}
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

function Stars({ n }: { n: number | null }) {
  if (n == null) return <span class="faint">—</span>;
  return <span class="stars" title={`${n} / 5`}>{'★★★★★'.slice(0, Math.round(n))}<span class="off">{'★★★★★'.slice(Math.round(n))}</span> <span class="mono">{n}</span></span>;
}

const WOULD: Record<string, string> = { yes: 'Da', maybe: 'Možda', no: 'Ne' };

function FeedbackBlock({ r, fb, back }: { r: InterviewRow; fb?: FeedbackRow; back: string }) {
  const avg = avgRating(fb);
  return (
    <details class={`fb ${fb ? 'done' : 'todo'}`}>
      <summary>
        {fb ? (
          <span class="fb-sum">
            <span>{fb.feeling ? FEELINGS[fb.feeling] : 'Ocenjeno'}</span>
            <span>Intervjuer <Stars n={avg} /></span>
            {fb.would_work && <span>Radio bih kod njih: <b>{WOULD[fb.would_work]}</b></span>}
            {fb.red_flags && <span class="flag">⚑ red flags</span>}
            <span class="faint mono" style="font-size:.68rem">izmeni</span>
          </span>
        ) : (
          <span class="fb-cta">Kako je prošlo? Oceni intervju →</span>
        )}
      </summary>
      <form method="post" action={`/interviews/${r.id}/feedback`} class="fb-form">
        <input type="hidden" name="back" value={back} />
        <div class="fb-q">Kako si se osećao tokom i posle razgovora?</div>
        <div class="feel">
          {[1, 2, 3, 4, 5].map((n) => (
            <label><input type="radio" name="feeling" value={n} checked={fb?.feeling === n} /><span>{FEELINGS[n]}</span></label>
          ))}
        </div>
        <div class="field"><textarea name="feeling_text" rows={3} placeholder="Opiši svojim rečima: šta te je opustilo, šta te je izbacilo iz ritma, da li si se osećao poštovano…">{fb?.feeling_text ?? ''}</textarea></div>
        <div class="fb-q">Kako ocenjuješ intervjuera i proces?</div>
        <div class="ratings">
          {RATINGS.map(([k, label]) => (
            <div class="rate-row">
              <span>{label}</span>
              <span class="rate">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label title={String(n)}><input type="radio" name={k} value={n} checked={fb?.[k] === n} /><span>{n}</span></label>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div class="form-grid">
          <div class="field"><label>Red flags</label><textarea name="red_flags" rows={2} placeholder="npr. kasnili 15 min, nisu znali platu, pritisak na neplaćeni test…">{fb?.red_flags ?? ''}</textarea></div>
          <div class="field"><label>Beleške za sledeći krug</label><textarea name="notes" rows={2}>{fb?.notes ?? ''}</textarea></div>
        </div>
        <div class="fb-q">Da li bi radio kod njih posle ovog razgovora?</div>
        <div class="feel">
          {(['yes', 'maybe', 'no'] as const).map((v) => (
            <label><input type="radio" name="would_work" value={v} checked={fb?.would_work === v} /><span>{WOULD[v]}</span></label>
          ))}
        </div>
        <div class="form-actions"><button type="submit" class="btn btn-solid btn-sm">Sačuvaj ocenu</button></div>
      </form>
    </details>
  );
}

function RecordingBlock({ r, rec }: { r: InterviewRow; rec: RecordingRow }) {
  const link = safeUrl(rec.share_url || rec.url);
  return (
    <div class="rec">
      <div class="rec-head">
        <span class="rec-badge">🎙 Fathom</span>
        {link && <a href={link} target="_blank" rel="noopener noreferrer">snimak ↗</a>}
        <AskClaude prompt={PROMPTS.analyze(r.id, r.company ?? '')} label={rec.analysis ? 'Analiziraj ponovo' : 'Analiziraj intervju'} />
      </div>
      {rec.analysis && <details class="rec-part" open><summary>Claude analiza</summary><div class="prose" style="padding:0">{raw(renderMarkdown(rec.analysis))}</div></details>}
      {rec.summary && <details class="rec-part"><summary>Fathom rezime</summary><div class="prose" style="padding:0">{raw(renderMarkdown(rec.summary))}</div></details>}
      {rec.action_items && <details class="rec-part"><summary>Akcioni koraci</summary><div class="prose" style="padding:0">{raw(renderMarkdown(rec.action_items))}</div></details>}
      {rec.transcript && <details class="rec-part"><summary>Transkript</summary><div class="transcript">{rec.transcript}</div></details>}
      {!rec.summary && !rec.transcript && <div class="faint" style="font-size:.8rem">Sadržaj snimka još nije stigao.</div>}
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
  const { fb, rec } = await extrasFor(c.env.DB, [...up, ...past].map((x) => x.id));
  const fathom = await getConfig(c.env.DB);
  const { results: loose } = await c.env.DB.prepare("SELECT id, title, started_at FROM recordings WHERE interview_id IS NULL ORDER BY started_at DESC LIMIT 15").all<{ id: number; title: string | null; started_at: string | null }>();
  const fState = c.req.query('fathom');
  const fMsg = c.req.query('msg');
  const linkable = [...up, ...past];
  return c.html(
    <Layout title="Kalendar" active="calendar" user={user}>
      <Topbar crumb={<b>Kalendar intervjua</b>} />
      <div class="content" style="max-width:1000px">
        {ok && <Flash>{ok === 'del' ? 'Intervju je obrisan.' : ok === 'fb' ? 'Ocena je sačuvana.' : 'Intervju je sačuvan.'}</Flash>}
        {fState === 'ok' && <Flash>Fathom je povezan. Snimci intervjua stižu ovde sami.</Flash>}
        {fState === 'off' && <Flash>Fathom je isključen.</Flash>}
        {fState === 'err' && <Flash kind="err">{fMsg ?? 'Povezivanje nije uspelo.'}</Flash>}
        <div class="page-head">
          <div>
            <h1>Kalendar</h1>
            <div class="sub">{up.length} predstojećih intervjua. Podsetnik stiže 1 dan i 1 sat pre početka.</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Predstojeći</h3></div>
          {up.length === 0 && <div class="faint" style="font-size:.88rem">Nema zakazanih intervjua. Agent ih upisuje sam kad stigne poziv na mejl, a možeš i ručno ispod.</div>}
          {up.map((r) => <InterviewItem r={r} back="/calendar" fb={fb.get(r.id)} rec={rec.get(r.id)} />)}
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

        <div class="panel" id="fathom">
          <div class="panel-head"><h3>Fathom snimci</h3>{fathom && <span class="faint mono" style="font-size:.68rem">povezano {fmtDateTime(fathom.connectedAt)}</span>}</div>
          {fathom ? (
            <>
              <div class="faint" style="font-size:.86rem;margin-bottom:10px">Kad Fathom završi snimak, Jobseeker ga sam poveže sa intervjuom po vremenu (±90 min) ili po firmi učesnika. Snimci koji nisu intervjui čuvaju se samo kao naslov i vreme, bez transkripta.</div>
              {(loose ?? []).length > 0 && (
                <div class="loose">
                  <div class="k">Snimci bez intervjua</div>
                  {(loose ?? []).map((l) => (
                    <form method="post" action={`/recordings/${l.id}/link`} class="loose-row">
                      <span>{l.title ?? 'Snimak'} <span class="faint mono" style="font-size:.7rem">{l.started_at ? fmtWhen(l.started_at) : ''}</span></span>
                      <select name="interview_id"><option value="">Poveži sa intervjuom…</option>{linkable.map((x) => <option value={x.id}>{fmtWhen(x.starts_at)} · {x.company ?? x.title}</option>)}</select>
                      <button class="btn btn-line btn-sm" type="submit">Poveži</button>
                      <button class="btn btn-line btn-sm" type="submit" formaction={`/recordings/${l.id}/delete`}>Ukloni</button>
                    </form>
                  ))}
                </div>
              )}
              <form method="post" action="/fathom/disconnect" style="margin-top:10px" onsubmit="return confirm('Isključiti Fathom? Webhook se briše u Fathom-u.')">
                <button class="btn btn-line btn-sm" type="submit">Isključi Fathom</button>
              </form>
            </>
          ) : (
            <>
              <ol class="steps-ol">
                <li>Napravi besplatan nalog na <a href="https://fathom.video" target="_blank" rel="noopener noreferrer">fathom.video</a> i poveži Google Calendar, da Fathom ulazi u tvoje pozive.</li>
                <li>U Fathom-u: <b>Settings → API Access → Generate API key</b>.</li>
                <li>Nalepi ključ ovde. Jobseeker sam napravi webhook u Fathom-u.</li>
              </ol>
              <form method="post" action="/fathom/connect" class="ics-row">
                <input name="api_key" type="password" required placeholder="Fathom API ključ" autocomplete="off" />
                <button class="btn btn-solid btn-sm" type="submit">Poveži Fathom</button>
              </form>
              <div class="faint" style="font-size:.78rem;margin-top:6px">Ključ se čuva u tvojoj bazi i koristi samo za webhook i preuzimanje snimaka. Pre snimanja pitaj intervjuere da li se slažu.</div>
            </>
          )}
        </div>

        {past.length > 0 && (
          <div class="panel">
            <div class="panel-head"><h3>Prošli</h3></div>
            {past.map((r) => <InterviewItem r={r} back="/calendar" fb={fb.get(r.id)} rec={rec.get(r.id)} />)}
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
