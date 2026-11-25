import { Hono } from 'hono';
import type { Env, SessionUser, JobRow, JobStatus } from '../../types';
import { STATUSES, STATUS_LABEL, STATUS_COLOR, LEVEL_LABEL, SOURCE_LABEL, isStatus, isLevel } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { StatusPill, LevelTag, FitBadge, Flash, safeUrl, hostOf, fmtDate, fmtDateTime, todayISO, SalaryTag, RisksText, salaryText } from '../../views/helpers';
import { getRates } from '../fx/service';
import { CalcPanel, CALC_FOOTNOTE, type CalcOffer } from '../calculator/view';
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

jobRoutes.get('/jobs/:id', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const job = await getJob(c.env.DB, id);
  if (!job) return c.text('Posao ne postoji.', 404);
  const [events, pkg, fx] = await Promise.all([listEvents(c.env.DB, id), getPackage(c.env.DB, id), getRates(c.env.DB)]);
  const ok = c.req.query('ok');
  const edit = c.req.query('edit') === '1';
  const link = safeUrl(job.url);

  return c.html(
    <Layout title={`${job.title} · ${job.company}`} active="jobs" user={user}>
      <Topbar crumb={<><a href="/jobs">Poslovi</a> / <b>{job.company}</b></>} />
      <div class="content">
        {ok && OK_MSG[ok] && <Flash>{OK_MSG[ok]}</Flash>}
        <div class="lead-head">
          <div>
            <h1>{job.title}</h1>
            <div class="co">
              {job.company} · <LevelTag level={job.level} /> · <FitBadge fit={job.fit} />
              {salaryText(job) && <> · <SalaryTag job={job} /></>}
            </div>
          </div>
          <div class="inline-actions">
            {link && <a href={link} target="_blank" rel="noopener noreferrer" class="btn btn-line btn-sm">Otvori oglas ↗</a>}
            <a href={`/jobs/${id}?edit=1`} class="btn btn-line btn-sm">Izmeni</a>
          </div>
        </div>

        {edit ? (
          <JobForm job={job} action={`/jobs/${id}/edit`} />
        ) : (
          <div class="layout">
            <div class="stack">
              <div class="panel">
                <div class="panel-head"><h3>Status</h3></div>
                <form method="post" action={`/jobs/${id}/status`} class="status-form">
                  {STATUSES.map((s) => (
                    <button type="submit" name="status" value={s} class={job.status === s ? 'on' : ''} style={`--pc:${STATUS_COLOR[s]}`}>
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </form>
                <div class="kv" style="margin-top:18px">
                  <div><div class="k">Lokacija</div><div class="v">{job.location ?? '—'}</div></div>
                  <div><div class="k">Ugovor</div><div class="v">{job.contract_type ?? '—'}</div></div>
                  <div><div class="k">Domen</div><div class="v">{job.domain ?? '—'}</div></div>
                </div>
                {job.risks && <div class="kv-note"><div class="k">Zašto / rizici</div><RisksText text={job.risks} /></div>}
                {job.next_step && <div class="kv-note"><div class="k">Sledeći korak</div>{job.next_step}</div>}
                {job.notes && <div class="kv-note"><div class="k">Moje beleške</div>{job.notes}</div>}
              </div>

              <div class="panel">
                <div class="panel-head">
                  <h3>Kalkulator plate</h3>
                  <a href="/calculator" class="faint mono" style="font-size:.7rem">veliki kalkulator →</a>
                </div>
                {!offerOf(job) && <div class="faint" style="font-size:.86rem;margin-bottom:10px">Oglas nema navedenu platu. Upiši je u „Izmeni“ ako je saznaš, pa ćeš ovde dobiti poređenje sa svojom ponudom.</div>}
                <CalcPanel fx={fx} offer={offerOf(job)} mode={defaultCalcMode(job)} compact />
                <div class="faint calc-foot">{CALC_FOOTNOTE}</div>
              </div>

              <div class="panel">
                <div class="panel-head">
                  <h3>Paket za prijavu</h3>
                  {pkg && <span class="faint mono" style="font-size:.68rem">izmenjen {fmtDateTime(pkg.updated_at)}</span>}
                </div>
                {!pkg && <div class="faint" style="font-size:.88rem;margin-bottom:12px">Agent pravi paket za oglase sa ocenom 7+. Možeš i sam da ga napišeš.</div>}
                <form method="post" action={`/jobs/${id}/package`}>
                  <div class="field">
                    <label>Cover letter</label>
                    <textarea name="cover_letter" rows={pkg?.cover_letter ? 14 : 4} id="cl">{pkg?.cover_letter ?? ''}</textarea>
                    {pkg?.cover_letter && <div class="copy-row"><button type="button" class="btn btn-line btn-sm" data-copy="cl">Kopiraj</button></div>}
                  </div>
                  <div class="field">
                    <label>CV bulleti za ovaj oglas</label>
                    <textarea name="cv_bullets" rows={pkg?.cv_bullets ? 8 : 3} id="cv">{pkg?.cv_bullets ?? ''}</textarea>
                    {pkg?.cv_bullets && <div class="copy-row"><button type="button" class="btn btn-line btn-sm" data-copy="cv">Kopiraj</button></div>}
                  </div>
                  <div class="field">
                    <label>Odgovori na pitanja iz prijave</label>
                    <textarea name="answers" rows={pkg?.answers ? 10 : 3} id="ans">{pkg?.answers ?? ''}</textarea>
                    {pkg?.answers && <div class="copy-row"><button type="button" class="btn btn-line btn-sm" data-copy="ans">Kopiraj</button></div>}
                  </div>
                  <div class="form-actions"><button type="submit" class="btn btn-solid btn-sm">Sačuvaj paket</button></div>
                </form>
              </div>

              <div class="panel">
                <div class="panel-head"><h3>Istorija</h3></div>
                <form method="post" action={`/jobs/${id}/note`} style="display:flex;gap:8px;margin-bottom:10px">
                  <div class="field" style="flex:1;margin:0"><input name="body" placeholder="Dodaj belešku…" required /></div>
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
            </div>

            <div class="stack">
              <div class="panel">
                <div class="side-field"><div class="k">Izvor</div><div class="v">{SOURCE_LABEL[job.source]}</div></div>
                <div class="side-field"><div class="k">Pronađeno</div><div class="v">{fmtDate(job.found_at)}</div></div>
                <div class="side-field"><div class="k">Poslednja provera oglasa</div><div class="v">{job.verified_at ? fmtDate(job.verified_at) : '—'}</div></div>
                <div class="side-field"><div class="k">Prijava poslata</div><div class="v">{job.applied_at ? fmtDate(job.applied_at) : '—'}</div></div>
                <div class="side-field">
                  <div class="k">Follow-up</div>
                  <form method="post" action={`/jobs/${id}/followup`} style="display:flex;gap:6px">
                    <input class="date-input" name="date" placeholder="dd.mm.gggg." value={job.follow_up_on ? fmtDate(job.follow_up_on) : ''} style="flex:1;background:var(--surface-2);border:1px solid var(--hairline-strong);border-radius:3px;color:var(--ink);padding:.4em .5em" />
                    <button type="submit" class="btn btn-line btn-sm">OK</button>
                  </form>
                </div>
              </div>
              <div class="panel">
                <div class="panel-head"><h3>Ukloni</h3></div>
                <form method="post" action={`/jobs/${id}/exclude`}>
                  <div class="field"><input name="reason" placeholder="Razlog (npr. ne primaju Srbiju)" /></div>
                  <button type="submit" class="btn btn-line btn-sm" style="width:100%;justify-content:center">Izbaci, agent ga više ne vraća</button>
                </form>
                <form method="post" action={`/jobs/${id}/delete`} style="margin-top:8px" onsubmit="return confirm('Obrisati ovaj posao? Agent može ponovo da ga nađe.')">
                  <button type="submit" class="btn btn-danger btn-sm" style="width:100%;justify-content:center">Samo obriši</button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
      <script src="/copy.js" defer></script>
      {!edit && <script src="/calculator.js" defer></script>}
    </Layout>,
  );
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
  return c.redirect(`/jobs/${id}?ok=note`);
});

jobRoutes.post('/jobs/:id/package', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const body = await c.req.parseBody();
  await savePackage(c.env.DB, id, { cover_letter: str(body.cover_letter), cv_bullets: str(body.cv_bullets), answers: str(body.answers) }, user.name);
  return c.redirect(`/jobs/${id}?ok=pkg`);
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
