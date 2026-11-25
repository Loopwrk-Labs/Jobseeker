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

export function InterviewForm({ r, jobId, jobs, back, defaultStart }: { r?: InterviewRow; jobId?: number; jobs?: { id: number; company: string; title: string }[]; back: string; defaultStart?: string }) {
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
        <div class="field"><label>Početak (Beograd) *</label><input type="datetime-local" name="starts_at" required value={r ? utcToLocal(r.starts_at) : defaultStart ?? ''} /></div>
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

// ------------------------------------------------------------------ month grid

const TZ = 'Europe/Belgrade';
const dayKey = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const hhmm = (iso: string) => new Intl.DateTimeFormat('sr-Latn-RS', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const MONTHS = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar'];
const WD = ['pon', 'uto', 'sre', 'čet', 'pet', 'sub', 'ned'];

interface CalEvent { day: string; kind: 'iv' | 'fu' | 'applied'; time?: string; label: string; href: string; title: string }

const KIND_LABEL: Record<CalEvent['kind'], string> = { iv: 'Intervju', fu: 'Follow-up', applied: 'Prijava poslata' };
const WD_LONG = ['ponedeljak', 'utorak', 'sreda', 'četvrtak', 'petak', 'subota', 'nedelja'];

function MonthGrid({ ym, events, today, selected }: { ym: string; events: CalEvent[]; today: string; selected: string }) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const start = new Date(Date.UTC(y, m - 1, 1 - offset));
  const days: string[] = [];
  for (let i = 0; i < 42; i++) days.push(new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10));
  const weeks = days[35].slice(0, 7) === ym ? 6 : 5;
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  const order = (a: CalEvent, b: CalEvent) => ['iv', 'fu', 'applied'].indexOf(a.kind) - ['iv', 'fu', 'applied'].indexOf(b.kind) || (a.time ?? '').localeCompare(b.time ?? '');
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const inMonth = events.filter((e) => e.day.slice(0, 7) === ym);
  const count = (k: CalEvent['kind']) => inMonth.filter((e) => e.kind === k).length;
  const sel = (byDay.get(selected) ?? []).sort(order);
  const selDate = new Date(selected + 'T12:00:00Z');
  const selLabel = `${WD_LONG[(selDate.getUTCDay() + 6) % 7]}, ${Number(selected.slice(8))}. ${MONTHS[Number(selected.slice(5, 7)) - 1]}`;
  const dayHref = (d: string) => `/calendar?m=${d.slice(0, 7)}&d=${d}#cal`;

  return (
    <div class="panel calx" id="cal">
      <div class="calx-head">
        <div>
          <div class="calx-month">{MONTHS[m - 1]} <span>{y}</span></div>
          <div class="calx-sum">
            <span><i class="k-iv"></i>{count('iv')} {count('iv') === 1 ? 'intervju' : 'intervjua'}</span>
            <span><i class="k-fu"></i>{count('fu')} follow-up</span>
            <span><i class="k-applied"></i>{count('applied')} {count('applied') === 1 ? 'prijava' : 'prijava'}</span>
          </div>
        </div>
        <div class="calx-nav">
          <a href={`/calendar?m=${prev}#cal`} aria-label="Prethodni mesec">‹</a>
          <a href={`/calendar#cal`} class="t">Danas</a>
          <a href={`/calendar?m=${next}#cal`} aria-label="Sledeći mesec">›</a>
        </div>
      </div>

      <div class="calx-grid">
        {WD.map((d, i) => <div class={`calx-wd ${i > 4 ? 'we' : ''}`}>{d}</div>)}
        {days.slice(0, weeks * 7).map((d, i) => {
          const ev = (byDay.get(d) ?? []).sort(order);
          const out = d.slice(0, 7) !== ym;
          const ivs = ev.filter((e) => e.kind === 'iv');
          const rest = ev.filter((e) => e.kind !== 'iv');
          const cls = ['calx-day', out && 'out', d === today && 'today', d === selected && 'sel', i % 7 > 4 && 'we', d < today && 'past'].filter(Boolean).join(' ');
          return (
            <a href={dayHref(d)} class={cls} aria-label={`${d}: ${ev.length} stavki`}>
              <span class="calx-n">{Number(d.slice(8))}</span>
              {!out && (
                <span class="calx-evs">
                  {ivs.slice(0, 2).map((e) => <span class="calx-iv"><b>{e.time}</b> {e.label}</span>)}
                  {ivs.length > 2 && <span class="calx-x">+{ivs.length - 2}</span>}
                  {ev.length > 0 && (
                    <span class="calx-dots">
                      {ivs.map(() => <i class="k-iv m-only"></i>)}
                      {rest.slice(0, 5).map((e) => <i class={`k-${e.kind}`}></i>)}
                      {rest.length > 5 && <em>+{rest.length - 5}</em>}
                    </span>
                  )}
                </span>
              )}
            </a>
          );
        })}
      </div>

      <div class="calx-agenda">
        <div class="calx-agenda-head">
          <span class="calx-agenda-day">{selected === today ? 'Danas · ' : ''}{selLabel}</span>
          {selected >= today && <a href={`/calendar?m=${ym}&d=${selected}&new=${selected}#add`} class="btn btn-line btn-sm">+ Zakaži intervju</a>}
        </div>
        {sel.length === 0 ? (
          <div class="calx-empty">Ništa za ovaj dan.</div>
        ) : (
          <ul class="calx-list">
            {sel.map((e) => (
              <li>
                <a href={e.href} class={`calx-item k-${e.kind}`}>
                  <span class={`calx-time ${e.time ? '' : 'none'}`}>{e.time ?? (e.kind === 'fu' ? 'rok' : 'poslato')}</span>
                  <span class="calx-what"><b>{e.label}</b><span>{KIND_LABEL[e.kind]}{e.title.includes(' · ') ? ` · ${e.title.split(' · ').slice(1).join(' · ')}` : ''}</span></span>
                  <span class="calx-go">›</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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

  // Month grid data
  const today = dayKey(new Date().toISOString());
  const ym = /^\d{4}-\d{2}$/.test(c.req.query('m') ?? '') ? c.req.query('m')! : today.slice(0, 7);
  const [gy, gm] = ym.split('-').map(Number);
  const from = new Date(Date.UTC(gy, gm - 1, -7)).toISOString();
  const to = new Date(Date.UTC(gy, gm, 8)).toISOString();
  const [ivM, fuM, apM] = await Promise.all([
    c.env.DB.prepare('SELECT i.id, i.job_id, i.title, i.starts_at, i.with_whom, j.company FROM interviews i LEFT JOIN jobs j ON j.id = i.job_id WHERE i.starts_at BETWEEN ? AND ?').bind(from, to).all<{ id: number; job_id: number | null; title: string | null; starts_at: string; with_whom: string | null; company: string | null }>(),
    c.env.DB.prepare("SELECT id, company, title, follow_up_on FROM jobs WHERE status = 'applied' AND follow_up_on BETWEEN ? AND ?").bind(from.slice(0, 10), to.slice(0, 10)).all<{ id: number; company: string; title: string; follow_up_on: string }>(),
    c.env.DB.prepare('SELECT id, company, title, applied_at FROM jobs WHERE applied_at BETWEEN ? AND ?').bind(from.slice(0, 10), to.slice(0, 10)).all<{ id: number; company: string; title: string; applied_at: string }>(),
  ]);
  const calEvents: CalEvent[] = [
    ...(ivM.results ?? []).map((r) => ({ day: dayKey(r.starts_at), kind: 'iv' as const, time: hhmm(r.starts_at), label: r.company ?? r.title ?? 'Intervju', href: r.job_id ? `/jobs/${r.job_id}?tab=intervjui#fb-${r.id}` : `#fb-${r.id}`, title: `${r.title ?? 'Intervju'}${r.company ? ` · ${r.company}` : ''}${r.with_whom ? ` · ${r.with_whom}` : ''}` })),
    ...(fuM.results ?? []).map((r) => ({ day: r.follow_up_on.slice(0, 10), kind: 'fu' as const, label: r.company, href: `/jobs/${r.id}`, title: `Follow-up: ${r.company} · ${r.title}` })),
    ...(apM.results ?? []).map((r) => ({ day: r.applied_at.slice(0, 10), kind: 'applied' as const, label: r.company, href: `/jobs/${r.id}`, title: `Prijava poslata: ${r.company} · ${r.title}` })),
  ];
  const newDay = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('new') ?? '') ? c.req.query('new')! : null;
  const qd = c.req.query('d') ?? '';
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(qd) ? qd : ym === today.slice(0, 7) ? today : `${ym}-01`;
  const { fb, rec } = await extrasFor(c.env.DB, [...up, ...past].map((x) => x.id));
  const fathom = await getConfig(c.env.DB);
  const { results: loose } = await c.env.DB.prepare("SELECT id, title, started_at FROM recordings WHERE interview_id IS NULL ORDER BY started_at DESC LIMIT 15").all<{ id: number; title: string | null; started_at: string | null }>();
  const fState = c.req.query('fathom');
  const fMsg = c.req.query('msg');
  const linkable = [...up, ...past];
  return c.html(
    <Layout title="Kalendar" active="calendar" user={user}>
      <Topbar crumb={<b>Kalendar intervjua</b>} />
      <div class="content" style="max-width:1480px">
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

        <div class="cal-layout">
        <div class="cal-left">
        <div class="panel">
          <div class="panel-head"><h3>Predstojeći</h3></div>
          {up.length === 0 && <div class="faint" style="font-size:.88rem">Nema zakazanih intervjua. Agent ih upisuje sam kad stigne poziv na mejl, a možeš i ručno ispod.</div>}
          {up.map((r) => <InterviewItem r={r} back="/calendar" fb={fb.get(r.id)} rec={rec.get(r.id)} />)}
        </div>

        <details class="panel" id="add" open={up.length === 0 || !!newDay}>
          <summary class="panel-sum">+ Dodaj intervju{newDay ? ` za ${newDay.slice(8)}.${newDay.slice(5, 7)}.` : ''}</summary>
          <div style="margin-top:12px"><InterviewForm jobs={jobsRes.results ?? []} back="/calendar" defaultStart={newDay ? `${newDay}T10:00` : undefined} /></div>
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
        <div class="cal-right">
          <MonthGrid ym={ym} events={calEvents} today={today} selected={selected} />
        </div>
        </div>
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
