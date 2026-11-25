import { Hono } from 'hono';
import type { Env, SessionUser, JobRow, JobStatus } from '../../types';
import { STATUSES, STATUS_LABEL, STATUS_COLOR, LEVEL_LABEL, SOURCE_LABEL, isStatus, isLevel } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { StatusPill, LevelTag, FitBadge, Flash, safeUrl, hostOf, fmtDate, fmtDateTime, todayISO, SalaryTag, RisksText, salaryText } from '../../views/helpers';
import { getRates } from '../fx/service';
import { CalcPanel, CALC_FOOTNOTE, type CalcOffer } from '../calculator/view';
import { parseRisks, type Fact } from './facts';
import { jobInterviews, extrasFor } from '../calendar/service';
import { InterviewItem, InterviewForm } from '../calendar/routes';
import { jobContacts, ContactChip, ContactForm } from '../contacts/routes';
import { listCvs } from '../materials/routes';
import { AskClaude, PROMPTS } from '../../lib/claude';
import { renderMarkdown } from '../../lib/markdown';
import { raw } from 'hono/html';
const fmtMoney = (n: number, cur: string) => `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(n)} ${cur}`;
import { fmtWhen } from '../../lib/tz';
import { parseDateInput, stripDashes } from '../../lib/format';
import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  setStatus,
  setFollowUp,
  addEvent,
  listEvents,
  getPackage,
  savePackage,
  excludeJob,
  deleteJob,
  type JobInput,
} from './service';

type Vars = { user: SessionUser | null };
export const jobRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const OK_MSG: Record<string, string> = {
  created: 'Posao je dodat.',
  saved: 'Sačuvano.',
  status: 'Status je promenjen.',
  note: 'Beleška je dodata.',
  pkg: 'Paket je sačuvan.',
  ans: 'Odgovor je sačuvan u biblioteku.',
  iv: 'Intervju je sačuvan.',
  ct: 'Kontakt je sačuvan.',
  fb: 'Ocena intervjua je sačuvana.',
  fu: 'Follow-up je podešen.',
  excluded: 'Posao je izbačen. Agent ga više neće vraćati.',
  deleted: 'Posao je obrisan.',
};

function str(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function readInput(body: Record<string, unknown>): JobInput | string {
  const company = str(body.company);
  const title = str(body.title);
  if (!company || !title) return 'Firma i pozicija su obavezne.';
  const fitN = Number(String(body.fit ?? '').trim());
  const url = str(body.url);
  if (url && !safeUrl(url)) return 'Link mora da počinje sa http:// ili https://';
  return {
    company,
    title,
    level: isLevel(body.level) ? body.level : 'head',
    fit: Number.isInteger(fitN) && fitN >= 1 && fitN <= 10 ? fitN : null,
    location: str(body.location),
    contract_type: str(body.contract_type),
    domain: str(body.domain),
    url,
    risks: str(body.risks) && stripDashes(str(body.risks)!),
    next_step: str(body.next_step),
    notes: str(body.notes),
    ...readSalary(body),
  };
}

function numOrNull(v: unknown): number | null {
  const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return String(v ?? '').trim() && isFinite(n) && n > 0 ? n : null;
}

function readSalary(body: Record<string, unknown>) {
  let min = numOrNull(body.salary_min);
  let max = numOrNull(body.salary_max);
  if (min != null && max != null && min > max) [min, max] = [max, min];
  const has = min != null || max != null;
  const cur = String(body.salary_currency ?? '');
  const per = String(body.salary_period ?? '');
  const kind = String(body.salary_kind ?? '');
  return {
    salary_min: min,
    salary_max: max,
    salary_currency: has ? (['EUR', 'USD', 'GBP', 'RSD'].includes(cur) ? cur : 'EUR') : null,
    salary_period: has ? (['month', 'year', 'hour'].includes(per) ? per : 'month') : null,
    salary_kind: has ? (kind === 'net' ? 'net' : 'gross') : null,
  };
}

/** Contractor-style postings default the calculator to the paušal view. */
function defaultCalcMode(j: JobRow): 'emp' | 'contr' {
  const t = `${j.contract_type ?? ''} ${j.risks ?? ''}`.toLowerCase();
  return /contractor|contract|b2b|freelanc|upwork|hourly|ugovor o delu|paušal|eor/.test(t) && !/ugovor o radu|permanent/.test(t) ? 'contr' : 'emp';
}

function offerOf(j: JobRow): CalcOffer | null {
  const label = salaryText(j);
  if (!label) return null;
  const min = (j.salary_min ?? j.salary_max)!;
  const max = (j.salary_max ?? j.salary_min)!;
  return { min, max, currency: j.salary_currency ?? 'EUR', period: j.salary_period ?? 'month', kind: j.salary_kind ?? 'gross', label };
}

function dueTag(j: JobRow) {
  if (j.status !== 'applied' || !j.follow_up_on) return null;
  const t = todayISO();
  if (j.follow_up_on > t) return <span class="due">follow-up {fmtDate(j.follow_up_on)}</span>;
  return <span class="due over">follow-up {j.follow_up_on === t ? 'danas' : 'kasni'}</span>;
}

// ------------------------------------------------------------------ list / board

jobRoutes.get('/jobs', async (c) => {
  const user = c.get('user') as SessionUser;
  // Kanban (Tabla) is the default; the table is opt-in with ?view=grid.
  const view = c.req.query('view') === 'grid' ? 'grid' : 'board';
  const q = (c.req.query('q') ?? '').trim();
  const level = isLevel(c.req.query('level')) ? (c.req.query('level') as 'head' | 'mid') : undefined;
  const sortQ = c.req.query('sort');
  const sort = sortQ === 'found' || sortQ === 'updated' || sortQ === 'company' ? sortQ : 'fit';
  const stQ = c.req.queries('status') ?? [];
  const statusSel = stQ.filter(isStatus) as JobStatus[];
  const active = statusSel.length ? statusSel : view === 'board' ? STATUSES : (['review', 'ready', 'applied', 'interview', 'offer'] as JobStatus[]);
  const jobs = await listJobs(c.env.DB, { status: active, level, q: q || undefined, sort });
  const ok = c.req.query('ok');

  const link = (over: Record<string, string | string[] | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | string[] | undefined> = { view: view === 'grid' ? 'grid' : undefined, q: q || undefined, level, sort: sort === 'fit' ? undefined : sort, status: statusSel, ...over };
    for (const [k, v] of Object.entries(merged)) {
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
      else if (v) p.set(k, v);
    }
    const s = p.toString();
    return s ? `/jobs?${s}` : '/jobs';
  };
  const toggleStatus = (s: JobStatus) => {
    const base = statusSel.length ? statusSel : [];
    return link({ status: base.includes(s) ? base.filter((x) => x !== s) : [...base, s] });
  };

  return c.html(
    <Layout title="Poslovi" active="jobs" user={user}>
      <Topbar q={q} right={<a href="/jobs/new" class="btn btn-solid btn-sm">+ Dodaj posao</a>} />
      <div class="content">
        {ok && OK_MSG[ok] && <Flash>{OK_MSG[ok]}</Flash>}
        <div class="page-head">
          <div>
            <h1>Poslovi</h1>
            <div class="sub">
              {jobs.length} {statusSel.length ? 'u izabranim statusima' : view === 'board' ? 'ukupno' : 'aktivnih (bez odbijenih)'}
              {q ? ` · pretraga „${q}"` : ''}
            </div>
          </div>
          <div class="view-toggle">
            <a href={link({ view: undefined })} class={view === 'board' ? 'active' : ''}>Tabla</a>
            <a href={link({ view: 'grid' })} class={view === 'grid' ? 'active' : ''}>Tabela</a>
          </div>
        </div>

        <div class="toolbar">
          {STATUSES.map((s) => (
            <a href={toggleStatus(s)} class="chip" style={statusSel.includes(s) ? `border-color:${STATUS_COLOR[s]};color:var(--ink)` : ''}>
              {STATUS_LABEL[s]}
            </a>
          ))}
          <span class="faint mono" style="font-size:.7rem">|</span>
          <a href={link({ level: undefined })} class="chip" style={!level ? 'border-color:var(--ink);color:var(--ink)' : ''}>Svi nivoi</a>
          <a href={link({ level: 'head' })} class="chip" style={level === 'head' ? 'border-color:var(--ink);color:var(--ink)' : ''}>Head/Senior</a>
          <a href={link({ level: 'mid' })} class="chip" style={level === 'mid' ? 'border-color:var(--ink);color:var(--ink)' : ''}>Mid</a>
          {view === 'grid' && (
            <>
              <span class="faint mono" style="font-size:.7rem">|</span>
              {(
                [
                  ['fit', 'Fit'],
                  ['found', 'Najnoviji'],
                  ['updated', 'Izmenjeni'],
                  ['company', 'Firma A–Z'],
                ] as const
              ).map(([k, l]) => (
                <a href={link({ sort: k === 'fit' ? undefined : k })} class="chip" style={sort === k ? 'border-color:var(--ink);color:var(--ink)' : ''}>{l}</a>
              ))}
            </>
          )}
        </div>

        {jobs.length === 0 ? (
          <div class="panel">
            <div class="empty-state">
              <div class="es-title">Nema poslova ovde</div>
              <div class="es-text">Jutarnji agent puni ovu listu radnim danima u 7:43. Možeš i ručno da dodaš posao.</div>
              <div class="es-actions">
                <a href="/jobs/new" class="btn btn-solid btn-sm">Dodaj posao</a>
              </div>
            </div>
          </div>
        ) : view === 'board' ? (
          <div class="board" style={`--cols:${active.length}`}>
            {active.map((s) => {
              const col = jobs.filter((j) => j.status === s);
              return (
                <div class="col" style={`--cc:${STATUS_COLOR[s]}`}>
                  <div class="col-head">
                    <span class="dot"></span>
                    <span class="t">{STATUS_LABEL[s]}</span>
                    <span class="n">{col.length}</span>
                  </div>
                  <div class="col-body">
                    {col.length === 0 && <div class="col-empty">Prazno</div>}
                    {col.map((j) => (
                      <a href={`/jobs/${j.id}`} class="card-mini">
                        <div class="name">{j.title}</div>
                        <div class="co">{j.company}</div>
                        <SalaryTag job={j} />
                        <div class="foot">
                          <LevelTag level={j.level} />
                          <FitBadge fit={j.fit} />
                        </div>
                        {dueTag(j) && <div style="margin-top:6px">{dueTag(j)}</div>}
                      </a>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div class="panel flush table-wrap">
            <table class="wide compact">
              <thead>
                <tr>
                  <th>Pozicija</th>
                  <th>Nivo</th>
                  <th>Fit</th>
                  <th>Status</th>
                  <th>Plata (oglas)</th>
                  <th>Lokacija</th>
                  <th>Zašto / rizici</th>
                  <th>Sledeći korak</th>
                  <th>Link</th>
                  <th>Pronađeno</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr>
                    <td>
                      <a href={`/jobs/${j.id}`} class="job-title">{j.title}</a>
                      <div class="job-co">{j.company}</div>
                    </td>
                    <td><LevelTag level={j.level} /></td>
                    <td><FitBadge fit={j.fit} /></td>
                    <td>
                      <StatusPill status={j.status} />
                      {dueTag(j) && <div style="margin-top:4px">{dueTag(j)}</div>}
                    </td>
                    <td style="white-space:nowrap">{salaryText(j) ? <SalaryTag job={j} /> : <span class="faint">—</span>}</td>
                    <td class="wrap" style="min-width:160px">{j.location ?? '—'}</td>
                    <td class="wrap">{j.risks ? <RisksText text={j.risks} /> : '—'}</td>
                    <td class="wrap" style="min-width:180px">{j.next_step ?? '—'}</td>
                    <td>{safeUrl(j.url) ? <a class="host" href={safeUrl(j.url)!} target="_blank" rel="noopener noreferrer">{hostOf(j.url)} ↗</a> : '—'}</td>
                    <td class="mono" style="font-size:.74rem">{fmtDate(j.found_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>,
  );
});

// ------------------------------------------------------------------ form

function JobForm({ job, action, error }: { job?: Partial<JobRow>; action: string; error?: string }) {
  return (
    <form method="post" action={action} class="panel">
      {error && <Flash kind="err">{error}</Flash>}
      <div class="form-grid">
        <div class="field"><label>Firma *</label><input name="company" required value={job?.company ?? ''} /></div>
        <div class="field"><label>Pozicija *</label><input name="title" required value={job?.title ?? ''} /></div>
      </div>
      <div class="form-grid four">
        <div class="field">
          <label>Nivo</label>
          <select name="level">
            {(['head', 'mid'] as const).map((l) => <option value={l} selected={job?.level === l}>{LEVEL_LABEL[l]}</option>)}
          </select>
        </div>
        <div class="field"><label>Fit (1–10)</label><input name="fit" type="number" min={1} max={10} value={job?.fit ?? ''} /></div>
        <div class="field"><label>Ugovor</label><input name="contract_type" placeholder="employee / contractor / B2B" value={job?.contract_type ?? ''} /></div>
        <div class="field"><label>Domen</label><input name="domain" placeholder="fintech, payments…" value={job?.domain ?? ''} /></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Lokacija</label><input name="location" placeholder="Remote Europe, Srbija na listi" value={job?.location ?? ''} /></div>
        <div class="field"><label>Link (originalni oglas)</label><input name="url" type="url" value={job?.url ?? ''} /></div>
      </div>
      <div class="form-grid five">
        <div class="field"><label>Plata od</label><input name="salary_min" inputmode="decimal" value={job?.salary_min ?? ''} /></div>
        <div class="field"><label>Plata do</label><input name="salary_max" inputmode="decimal" value={job?.salary_max ?? ''} /></div>
        <div class="field">
          <label>Valuta</label>
          <select name="salary_currency">
            {['EUR', 'USD', 'GBP', 'RSD'].map((c) => <option value={c} selected={(job?.salary_currency ?? 'EUR') === c}>{c}</option>)}
          </select>
        </div>
        <div class="field">
          <label>Period</label>
          <select name="salary_period">
            {([['month', 'Mesečno'], ['year', 'Godišnje'], ['hour', 'Po satu']] as const).map(([v, l]) => <option value={v} selected={(job?.salary_period ?? 'month') === v}>{l}</option>)}
          </select>
        </div>
        <div class="field">
          <label>Bruto / neto</label>
          <select name="salary_kind">
            <option value="gross" selected={job?.salary_kind !== 'net'}>Bruto</option>
            <option value="net" selected={job?.salary_kind === 'net'}>Neto</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Zašto / rizici</label><textarea name="risks" rows={3}>{job?.risks ?? ''}</textarea></div>
      <div class="field"><label>Sledeći korak</label><input name="next_step" value={job?.next_step ?? ''} /></div>
      <div class="field"><label>Moje beleške</label><textarea name="notes" rows={3}>{job?.notes ?? ''}</textarea></div>
      <div class="form-actions">
        <a href={job?.id ? `/jobs/${job.id}` : '/jobs'} class="btn btn-line">Otkaži</a>
        <button type="submit" class="btn btn-solid">Sačuvaj</button>
      </div>
    </form>
  );
}

jobRoutes.get('/jobs/new', (c) => {
  const user = c.get('user') as SessionUser;
  return c.html(
    <Layout title="Novi posao" active="jobs" user={user}>
      <Topbar crumb={<><a href="/jobs">Poslovi</a> / <b>Novi</b></>} />
      <div class="content" style="max-width:900px">
        <div class="page-head"><h1>Dodaj posao</h1></div>
        <JobForm action="/jobs/new" />
      </div>
    </Layout>,
  );
});

jobRoutes.post('/jobs/new', async (c) => {
  const user = c.get('user') as SessionUser;
  const input = readInput(await c.req.parseBody());
  if (typeof input === 'string') {
    return c.html(
      <Layout title="Novi posao" active="jobs" user={user}>
        <Topbar crumb={<><a href="/jobs">Poslovi</a> / <b>Novi</b></>} />
        <div class="content" style="max-width:900px"><JobForm action="/jobs/new" error={input} /></div>
      </Layout>,
      400,
    );
  }
  const id = await createJob(c.env.DB, input, 'manual', user.name);
  return c.redirect(`/jobs/${id}?ok=created`);
});

// ------------------------------------------------------------------ detail

const TABS = [
  ['pregled', 'Pregled'],
  ['prijava', 'Prijava'],
  ['intervjui', 'Intervjui i ljudi'],
  ['plata', 'Plata'],
  ['istorija', 'Istorija'],
] as const;
type Tab = (typeof TABS)[number][0];

function FactTile({ f }: { f: Fact }) {
  return (
    <div class={`fact ${f.tone ? `t-${f.tone}` : ''}`}>
      <div class="k">{f.label}</div>
      <div class="h">{f.head}</div>
      {f.detail && <div class="d">{f.detail}</div>}
    </div>
  );
}

jobRoutes.get('/jobs/:id', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const job = await getJob(c.env.DB, id);
  if (!job) return c.text('Posao ne postoji.', 404);
  const q = c.req.query('tab');
  const tab: Tab = (TABS.find(([k]) => k === q)?.[0] ?? 'pregled') as Tab;
  const [events, pkg, fx, ivs, people, cvs, market] = await Promise.all([
    listEvents(c.env.DB, id),
    getPackage(c.env.DB, id),
    tab === 'plata' ? getRates(c.env.DB) : Promise.resolve(null),
    jobInterviews(c.env.DB, id),
    jobContacts(c.env.DB, id, job.company),
    tab === 'prijava' ? listCvs(c.env.DB) : Promise.resolve([]),
    tab === 'plata' ? c.env.DB.prepare('SELECT * FROM salary_research WHERE job_id = ?').bind(id).first<MarketRow>() : Promise.resolve(null),
  ]);
  const ivx = tab === 'intervjui' ? await extrasFor(c.env.DB, ivs.map((x) => x.id)) : { fb: new Map(), rec: new Map() };
  const nextIv = ivs.find((x) => new Date(x.starts_at).getTime() > Date.now() - 2 * 3600e3);
  const ok = c.req.query('ok');
  const edit = c.req.query('edit') === '1';
  const link = safeUrl(job.url);
  const { facts, notes, pay } = parseRisks(job.risks);
  const salary = salaryText(job);
  const hasPkg = !!(pkg && (pkg.cover_letter || pkg.cv_bullets || pkg.answers));
  const tabHref = (t: Tab) => (t === 'pregled' ? `/jobs/${id}` : `/jobs/${id}?tab=${t}`);
  const due = job.follow_up_on && job.status === 'applied' && job.follow_up_on <= todayISO();

  return c.html(
    <Layout title={`${job.title} · ${job.company}`} active="jobs" user={user}>
      <Topbar crumb={<><a href="/jobs">Poslovi</a> / <b>{job.company}</b></>} />
      <div class="content job-page">
        {ok && OK_MSG[ok] && <Flash>{OK_MSG[ok]}</Flash>}

        <div class="job-head">
          <div class="job-head-main">
            <div class="job-co-line">{job.company}</div>
            <h1>{job.title}</h1>
            <div class="job-meta">
              <LevelTag level={job.level} />
              <FitBadge fit={job.fit} />
              {salary && <SalaryTag job={job} />}
            </div>
          </div>
          <div class="inline-actions">
            {link && <a href={link} target="_blank" rel="noopener noreferrer" class="btn btn-solid btn-sm">Otvori oglas ↗</a>}
            <a href={`/jobs/${id}?edit=1`} class="btn btn-line btn-sm">Izmeni</a>
          </div>
        </div>

        <form method="post" action={`/jobs/${id}/status`} class="status-track">
          {STATUSES.map((s, i) => (
            <button type="submit" name="status" value={s} class={job.status === s ? 'on' : STATUSES.indexOf(job.status) > i && s !== 'rejected' ? 'past' : ''} style={`--pc:${STATUS_COLOR[s]}`}>
              <span class="d"></span>{STATUS_LABEL[s]}
            </button>
          ))}
        </form>

        {edit ? (
          <JobForm job={job} action={`/jobs/${id}/edit`} />
        ) : (
          <>
            {nextIv && (
              <a href={`/jobs/${id}?tab=intervjui`} class="next-step iv-next">
                <div class="k">Sledeći intervju</div>
                <div class="v">{fmtWhen(nextIv.starts_at)} · {nextIv.title || 'Intervju'}{nextIv.with_whom ? ` · ${nextIv.with_whom}` : ''}</div>
              </a>
            )}
            {(job.next_step || due) && (
              <div class={`next-step ${due ? 'due' : ''}`}>
                <div class="k">{due ? 'Follow-up je na redu' : 'Sledeći korak'}</div>
                <div class="v">{job.next_step ?? 'Pošalji follow-up poslodavcu.'}</div>
              </div>
            )}

            <nav class="tabs">
              {TABS.map(([k, l]) => (
                <a href={tabHref(k)} class={tab === k ? 'active' : ''}>
                  {l}
                  {k === 'prijava' && hasPkg && <span class="tab-dot" title="Paket je spreman"></span>}
                  {k === 'istorija' && events.length > 0 && <span class="tab-n">{events.length}</span>}
                  {k === 'intervjui' && ivs.length + people.length > 0 && <span class="tab-n">{ivs.length + people.length}</span>}
                </a>
              ))}
            </nav>

            <div class="layout">
              <div class="stack">
                {tab === 'pregled' && (
                  <>
                    <div class="panel">
                      <div class="panel-head"><h3>Osnovno</h3></div>
                      <div class="kv kv-4">
                        <div><div class="k">Plata (oglas)</div><div class="v">{salary ? <SalaryTag job={job} /> : pay ? <span class={/nije navedena|not stated/i.test(pay) ? 'faint' : 'salary-offer'}>{pay}</span> : <span class="faint">nije navedena</span>}</div></div>
                        <div><div class="k">Lokacija</div><div class="v">{job.location ?? '—'}</div></div>
                        <div><div class="k">Ugovor</div><div class="v">{job.contract_type ?? '—'}</div></div>
                        <div><div class="k">Domen</div><div class="v">{job.domain ?? '—'}</div></div>
                      </div>
                    </div>

                    {facts.length > 0 && (
                      <div class="panel">
                        <div class="panel-head"><h3>Uslovi rada</h3><span class="legend"><i class="t-good"></i>dobro <i class="t-warn"></i>pazi <i class="t-bad"></i>problem</span></div>
                        <div class="facts">{facts.map((f) => <FactTile f={f} />)}</div>
                      </div>
                    )}

                    {notes.length > 0 && (
                      <div class="panel">
                        <div class="panel-head"><h3>Na šta da obratiš pažnju</h3></div>
                        <ul class="notes-list">
                          {notes.map((n) => <li>{n.label && <b>{n.label}: </b>}{n.text}</li>)}
                        </ul>
                      </div>
                    )}

                    <div class="panel">
                      <div class="panel-head"><h3>Moje beleške</h3><a href={`/jobs/${id}?edit=1`} class="faint mono" style="font-size:.7rem">izmeni →</a></div>
                      {job.notes ? <div class="prewrap">{job.notes}</div> : <div class="faint" style="font-size:.88rem">Još nema beležaka. Agent ovo polje nikad ne menja.</div>}
                    </div>
                  </>
                )}

                {tab === 'prijava' && (
                  <div class="panel">
                    <div class="panel-head"><h3>CV za ovaj oglas</h3><a href="/materials" class="faint mono" style="font-size:.7rem">CV verzije →</a></div>
                    {cvs.length === 0 ? (
                      <div class="faint" style="font-size:.88rem">Još nema CV verzija. Dodaj ih u <a href="/materials">Materijali</a>; agent će birati pravu za svaki oglas.</div>
                    ) : (
                      <form method="post" action={`/jobs/${id}/cv`} class="cv-pick">
                        <select name="cv_version_id">
                          <option value="">— nije izabrano —</option>
                          {cvs.map((cv) => <option value={cv.id} selected={job.cv_version_id === cv.id}>{cv.name}{cv.is_default ? ' (podrazumevani)' : ''}</option>)}
                        </select>
                        <button class="btn btn-line btn-sm" type="submit">Sačuvaj</button>
                        {(() => {
                          const cur = cvs.find((x) => x.id === job.cv_version_id);
                          return cur?.has_file ? <a class="btn btn-solid btn-sm" href={`/materials/cv/${cur.id}/file`} target="_blank">Otvori PDF ↓</a> : null;
                        })()}
                      </form>
                    )}
                  </div>
                )}

                {tab === 'prijava' && (
                  <div class="panel">
                    <div class="panel-head">
                      <h3>Paket za prijavu</h3>
                      {pkg && <span class="faint mono" style="font-size:.68rem">izmenjen {fmtDateTime(pkg.updated_at)}</span>}
                    </div>
                    {!hasPkg && <div class="faint" style="font-size:.88rem;margin-bottom:12px">Agent pravi paket za oglase sa ocenom 7+. Možeš i sam da ga napišeš.</div>}
                    <form method="post" action={`/jobs/${id}/package`}>
                      {([['cover_letter', 'cl', 'Cover letter', 14], ['cv_bullets', 'cv', 'CV bulleti za ovaj oglas', 8], ['answers', 'ans', 'Odgovori na pitanja iz prijave', 10]] as const).map(([name, elId, label, rows]) => {
                        const val = (pkg as any)?.[name] as string | null | undefined;
                        return (
                          <div class="field pkg-field">
                            <div class="pkg-label"><label for={elId}>{label}</label>{val && <button type="button" class="btn btn-line btn-sm" data-copy={elId}>Kopiraj</button>}</div>
                            <textarea name={name} rows={val ? rows : 3} id={elId}>{val ?? ''}</textarea>
                          </div>
                        );
                      })}
                      <div class="form-actions"><button type="submit" class="btn btn-solid btn-sm">Sačuvaj paket</button></div>
                    </form>
                  </div>
                )}

                {tab === 'prijava' && (
                  <details class="panel">
                    <summary class="panel-sum">+ Sačuvaj pitanje i odgovor u biblioteku</summary>
                    <form method="post" action="/materials/answers" style="margin-top:12px">
                      <input type="hidden" name="job_id" value={id} />
                      <input type="hidden" name="company" value={job.company} />
                      <input type="hidden" name="back" value={`/jobs/${id}?tab=prijava&ok=ans`} />
                      <div class="field"><label>Pitanje iz forme</label><input name="question" required /></div>
                      <div class="field"><label>Tvoj odgovor</label><textarea name="answer" rows={5} required></textarea></div>
                      <div class="field"><label>Tagovi (zarezom)</label><input name="tags" /></div>
                      <div class="form-actions"><a href="/materials?tab=answers" class="faint mono" style="font-size:.72rem;margin-right:auto">otvori biblioteku →</a><button class="btn btn-solid btn-sm" type="submit">Sačuvaj u biblioteku</button></div>
                    </form>
                  </details>
                )}

                {tab === 'intervjui' && (
                  <>
                    <div class="panel">
                      <div class="panel-head"><h3>Intervjui</h3><AskClaude prompt={PROMPTS.prep(id, job.company, job.title)} label="Pripremi me za intervju" /></div>
                      {ivs.length === 0 && <div class="faint" style="font-size:.88rem;margin-bottom:10px">Nema zakazanih intervjua. Kad agent nađe poziv u mejlu, upisaće ga ovde.</div>}
                      {ivs.map((r) => <InterviewItem r={r} showJob={false} back={`/jobs/${id}?tab=intervjui`} fb={ivx.fb.get(r.id)} rec={ivx.rec.get(r.id)} />)}
                      <details style="margin-top:10px">
                        <summary class="panel-sum">+ Zakaži intervju</summary>
                        <div style="margin-top:12px"><InterviewForm jobId={id} back={`/jobs/${id}?tab=intervjui`} /></div>
                      </details>
                    </div>
                    <div class="panel">
                      <div class="panel-head"><h3>Ljudi u firmi</h3><a href="/contacts" class="faint mono" style="font-size:.7rem">svi kontakti →</a></div>
                      {people.length === 0 && <div class="faint" style="font-size:.88rem;margin-bottom:10px">Još nema kontakata za ovaj oglas.</div>}
                      <div class="contact-list">{people.map((p) => <ContactChip r={p} />)}</div>
                      <details style="margin-top:10px">
                        <summary class="panel-sum">+ Dodaj kontakt</summary>
                        <div style="margin-top:12px"><ContactForm jobId={id} company={job.company} back={`/jobs/${id}?tab=intervjui`} /></div>
                      </details>
                    </div>
                  </>
                )}

                {tab === 'plata' && fx && (
                  <div class="panel">
                    <div class="panel-head">
                      <h3>Kalkulator plate</h3>
                      <a href="/calculator" class="faint mono" style="font-size:.7rem">veliki kalkulator →</a>
                    </div>
                    {!offerOf(job) && <div class="faint" style="font-size:.86rem;margin-bottom:10px">Oglas nema navedenu platu. Upiši je u „Izmeni“ ako je saznaš, pa ćeš ovde dobiti poređenje sa svojom ponudom.</div>}
                    <CalcPanel fx={fx} offer={offerOf(job)} mode={defaultCalcMode(job)} compact />
                    <div class="faint calc-foot">{CALC_FOOTNOTE}</div>
                  </div>
                )}

                {tab === 'plata' && (
                  <div class="panel">
                    <div class="panel-head">
                      <h3>Tržište i kontraponuda</h3>
                      <AskClaude prompt={PROMPTS.salary(id, job.company, job.title)} label={market ? 'Osveži istraživanje' : 'Istraži tržište'} />
                    </div>
                    {!market && <div class="faint" style="font-size:.88rem;margin-bottom:12px">Claude istraži plate za ovu ulogu i predloži kontraponudu. Rezultat se upiše ovde.</div>}
                    {market && (
                      <>
                        <div class="kv kv-4" style="margin-bottom:14px">
                          <div><div class="k">Plata iz oglasa</div><div class="v">{salaryText(job) ? <SalaryTag job={job} /> : <span class="faint">nije navedena</span>}</div></div>
                          <div><div class="k">Tržište</div><div class="v">{market.market_min != null ? `${fmtMoney(market.market_min, market.market_currency ?? 'EUR')} – ${fmtMoney(market.market_max ?? market.market_min, market.market_currency ?? 'EUR')}` : '—'}<span class="faint"> {market.market_period === 'year' ? '/ god.' : market.market_period === 'hour' ? '/ h' : '/ mes.'}</span></div></div>
                          <div><div class="k">Predlog kontraponude</div><div class="v"><b>{market.counter_amount != null ? fmtMoney(market.counter_amount, market.market_currency ?? 'EUR') : '—'}</b></div></div>
                          <div><div class="k">Ažurirano</div><div class="v">{fmtDate(market.updated_at)}</div></div>
                        </div>
                        {market.counter_text && (
                          <div class="field pkg-field">
                            <div class="pkg-label"><label>Tekst za pregovore</label><button type="button" class="btn btn-line btn-sm" data-copy-text={market.counter_text}>Kopiraj</button></div>
                            <div class="prewrap quote">{market.counter_text}</div>
                          </div>
                        )}
                        {market.market_sources && <div class="prose sources" style="padding:0;font-size:.84rem">{raw(renderMarkdown(market.market_sources))}</div>}
                      </>
                    )}
                    <details style="margin-top:12px">
                      <summary class="panel-sum">Unesi ili ispravi ručno</summary>
                      <form method="post" action={`/jobs/${id}/market`} style="margin-top:12px">
                        <div class="form-grid four">
                          <div class="field"><label>Tržište od</label><input name="market_min" inputmode="decimal" value={market?.market_min ?? ''} /></div>
                          <div class="field"><label>Tržište do</label><input name="market_max" inputmode="decimal" value={market?.market_max ?? ''} /></div>
                          <div class="field"><label>Valuta</label><select name="market_currency">{['EUR', 'USD', 'GBP', 'RSD'].map((cur) => <option selected={(market?.market_currency ?? job.salary_currency ?? 'EUR') === cur}>{cur}</option>)}</select></div>
                          <div class="field"><label>Period</label><select name="market_period">{([['month', 'Mesečno'], ['year', 'Godišnje'], ['hour', 'Po satu']] as const).map(([v, l]) => <option value={v} selected={(market?.market_period ?? job.salary_period ?? 'month') === v}>{l}</option>)}</select></div>
                        </div>
                        <div class="form-grid">
                          <div class="field"><label>Kontraponuda</label><input name="counter_amount" inputmode="decimal" value={market?.counter_amount ?? ''} /></div>
                          <div class="field"><label>Izvori (link po redu)</label><textarea name="market_sources" rows={2}>{market?.market_sources ?? ''}</textarea></div>
                        </div>
                        <div class="field"><label>Tekst za pregovore</label><textarea name="counter_text" rows={4}>{market?.counter_text ?? ''}</textarea></div>
                        <div class="form-actions"><button class="btn btn-solid btn-sm" type="submit">Sačuvaj</button></div>
                      </form>
                    </details>
                  </div>
                )}

                {tab === 'istorija' && (
                  <div class="panel">
                    <form method="post" action={`/jobs/${id}/note`} style="display:flex;gap:8px;margin-bottom:10px">
                      <div class="field" style="flex:1;margin:0"><input name="body" placeholder="Dodaj belešku u istoriju…" required /></div>
                      <button type="submit" class="btn btn-line btn-sm">Dodaj</button>
                    </form>
                    {events.length === 0 && <div class="faint" style="font-size:.86rem">Još nema zapisa.</div>}
                    {events.map((e) => (
                      <div class="ev">
                        <div class="who">{fmtDateTime(e.created_at)}<br />{e.actor}</div>
                        <div class="body">{e.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div class="stack">
                <div class="panel">
                  <div class="panel-head"><h3>Tok</h3></div>
                  <div class="timeline">
                    <div class="done"><span class="k">Pronađeno</span><span class="v">{fmtDate(job.found_at)}</span></div>
                    <div class={job.verified_at ? 'done' : ''}><span class="k">Oglas proveren</span><span class="v">{job.verified_at ? fmtDate(job.verified_at) : '—'}</span></div>
                    <div class={job.applied_at ? 'done' : ''}><span class="k">Prijava poslata</span><span class="v">{job.applied_at ? fmtDate(job.applied_at) : '—'}</span></div>
                  </div>
                  <div class="side-field" style="margin-top:14px">
                    <div class="k">Follow-up</div>
                    <form method="post" action={`/jobs/${id}/followup`} style="display:flex;gap:6px">
                      <input class="date-input" name="date" placeholder="dd.mm.gggg." value={job.follow_up_on ? fmtDate(job.follow_up_on) : ''} style="flex:1;background:var(--surface-2);border:1px solid var(--hairline-strong);border-radius:3px;color:var(--ink);padding:.4em .5em" />
                      <button type="submit" class="btn btn-line btn-sm">OK</button>
                    </form>
                  </div>
                  <div class="side-field" style="margin:0"><div class="k">Izvor</div><div class="v">{SOURCE_LABEL[job.source]}{link && <> · <a href={link} target="_blank" rel="noopener noreferrer" class="host">{hostOf(job.url)} ↗</a></>}</div></div>
                </div>

                <details class="panel danger-zone">
                  <summary>Ukloni posao</summary>
                  <form method="post" action={`/jobs/${id}/exclude`} style="margin-top:12px">
                    <div class="field"><input name="reason" placeholder="Razlog (npr. ne primaju Srbiju)" /></div>
                    <button type="submit" class="btn btn-line btn-sm" style="width:100%;justify-content:center">Izbaci, agent ga više ne vraća</button>
                  </form>
                  <form method="post" action={`/jobs/${id}/delete`} style="margin-top:8px" onsubmit="return confirm('Obrisati ovaj posao? Agent može ponovo da ga nađe.')">
                    <button type="submit" class="btn btn-danger btn-sm" style="width:100%;justify-content:center">Samo obriši</button>
                  </form>
                </details>
              </div>
            </div>
          </>
        )}
      </div>
      {!edit && tab === 'plata' && <script src="/calculator.js" defer></script>}
    </Layout>,
  );
});

interface MarketRow {
  job_id: number;
  market_min: number | null;
  market_max: number | null;
  market_currency: string | null;
  market_period: string | null;
  market_sources: string | null;
  counter_amount: number | null;
  counter_text: string | null;
  updated_at: string;
}

jobRoutes.post('/jobs/:id/cv', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const cv = Number(b.cv_version_id) || null;
  await c.env.DB.prepare(`UPDATE jobs SET cv_version_id = ?, updated_at = datetime('now') WHERE id = ?`).bind(cv, id).run();
  return c.redirect(`/jobs/${id}?tab=prijava&ok=saved`);
});

jobRoutes.post('/jobs/:id/market', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const n = (v: unknown) => numOrNull(v);
  const cur = ['EUR', 'USD', 'GBP', 'RSD'].includes(String(b.market_currency)) ? String(b.market_currency) : 'EUR';
  const per = ['month', 'year', 'hour'].includes(String(b.market_period)) ? String(b.market_period) : 'month';
  await c.env.DB.prepare(
    `INSERT INTO salary_research (job_id, market_min, market_max, market_currency, market_period, market_sources, counter_amount, counter_text, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(job_id) DO UPDATE SET market_min=excluded.market_min, market_max=excluded.market_max, market_currency=excluded.market_currency,
       market_period=excluded.market_period, market_sources=excluded.market_sources, counter_amount=excluded.counter_amount,
       counter_text=excluded.counter_text, updated_at=datetime('now')`,
  ).bind(id, n(b.market_min), n(b.market_max), cur, per, str(b.market_sources), n(b.counter_amount), str(b.counter_text)).run();
  return c.redirect(`/jobs/${id}?tab=plata&ok=saved`);
});

jobRoutes.post('/jobs/:id/edit', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const input = readInput(await c.req.parseBody());
  if (typeof input === 'string') return c.redirect(`/jobs/${id}?edit=1`);
  await updateJob(c.env.DB, id, input, user.name);
  return c.redirect(`/jobs/${id}?ok=saved`);
});

jobRoutes.post('/jobs/:id/status', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  if (isStatus(body.status)) await setStatus(c.env.DB, id, body.status, user.name);
  return c.redirect(`/jobs/${id}?ok=status`);
});

jobRoutes.post('/jobs/:id/followup', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  await setFollowUp(c.env.DB, id, parseDateInput(body.date), user.name);
  return c.redirect(`/jobs/${id}?ok=fu`);
});

jobRoutes.post('/jobs/:id/note', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  const text = str(body.body);
  if (text) await addEvent(c.env.DB, id, user.name, text);
  return c.redirect(`/jobs/${id}?tab=istorija&ok=note`);
});

jobRoutes.post('/jobs/:id/package', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  await savePackage(c.env.DB, id, { cover_letter: str(body.cover_letter), cv_bullets: str(body.cv_bullets), answers: str(body.answers) }, user.name);
  return c.redirect(`/jobs/${id}?tab=prijava&ok=pkg`);
});

jobRoutes.post('/jobs/:id/exclude', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  await excludeJob(c.env.DB, id, str(body.reason));
  return c.redirect('/jobs?ok=excluded');
});

jobRoutes.post('/jobs/:id/delete', async (c) => {
  await deleteJob(c.env.DB, Number(c.req.param('id')));
  return c.redirect('/jobs?ok=deleted');
});
