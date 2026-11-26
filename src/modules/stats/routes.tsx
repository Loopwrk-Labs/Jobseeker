import { Hono } from 'hono';
import type { Env, SessionUser, JobRow } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { hostOf } from '../../views/helpers';
import { parseRisks } from '../jobs/facts';
import { FEELINGS } from '../calendar/service';
import { REPLY_STATUS_LABEL, type RejectionRow } from '../rejections/routes';
import { STAGE_LABEL } from '../rejections/template';
import { fmtDate } from '../../lib/format';

type Vars = { user: SessionUser | null };
export const statsRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

type J = Pick<JobRow, 'id' | 'status' | 'source' | 'url' | 'contract_type' | 'level' | 'risks' | 'applied_at' | 'found_at'> & { n_iv: number };

const APPLIED = new Set(['applied', 'interview', 'offer']);
const applied = (j: J) => !!j.applied_at || APPLIED.has(j.status);
const responded = (j: J) => applied(j) && (j.status === 'interview' || j.status === 'offer' || j.status === 'rejected' || j.n_iv > 0);
const interviewed = (j: J) => j.status === 'interview' || j.status === 'offer' || j.n_iv > 0;

const PLATFORMS: [RegExp, string][] = [
  [/greenhouse/, 'Greenhouse'], [/lever\.co/, 'Lever'], [/ashbyhq/, 'Ashby'], [/workable/, 'Workable'], [/teamtailor/, 'Teamtailor'],
  [/recruitee/, 'Recruitee'], [/pinpoint/, 'Pinpoint'], [/breezy/, 'Breezy'], [/personio/, 'Personio'], [/smartrecruiters/, 'SmartRecruiters'],
  [/workday|myworkdayjobs/, 'Workday'], [/upwork/, 'Upwork'], [/infostud/, 'Infostud'], [/helloworld/, 'HelloWorld'], [/joberty/, 'Joberty'],
  [/linkedin/, 'LinkedIn'], [/dynamitejobs/, 'Dynamite Jobs'], [/wellfound/, 'Wellfound'], [/braintrust/, 'Braintrust'], [/contra\.com/, 'Contra'],
];
function platform(j: J): string {
  if (j.source === 'gmail' && !j.url) return 'Iz Gmail-a';
  const h = hostOf(j.url);
  if (!h) return j.source === 'manual' ? 'Ručno (bez linka)' : 'Nepoznato';
  return PLATFORMS.find(([re]) => re.test(h))?.[1] ?? 'Sajt firme';
}
function contract(j: J): string {
  const t = `${j.contract_type ?? ''}`.toLowerCase();
  if (!t) return 'Nije navedeno';
  if (/upwork|freelanc|braintrust|contra\b/.test(t)) return 'Freelance platforma';
  if (/part-time|part time|\d+\s*h\/ned/.test(t) && !/full-time/.test(t)) return 'Part-time';
  if (/projek|project/.test(t)) return 'Projekat';
  if (/contractor|contract|b2b|eor/.test(t)) return 'Contractor / B2B';
  return 'Zaposlenje (full-time)';
}
function group(j: J): string {
  const g = parseRisks(j.risks).facts.find((f) => f.key === 'group')?.head;
  if (g) {
    const s = g.toLowerCase();
    if (s.includes('junior ops')) return 'Junior ops/admin';
    if (s.includes('quickbase') || s.includes('low-code')) return 'Quickbase / low-code';
    if (s.includes('paralel')) return 'Paralelno / Mid';
    if (s.includes('head') || s.includes('senior')) return 'Head / Senior';
    if (s.includes('mid')) return 'Mid';
  }
  return j.level === 'head' ? 'Head / Senior' : 'Mid';
}

interface Agg { key: string; total: number; applied: number; responded: number; interviews: number; offers: number }
function aggregate(jobs: J[], by: (j: J) => string): Agg[] {
  const m = new Map<string, Agg>();
  for (const j of jobs) {
    const k = by(j);
    const a = m.get(k) ?? { key: k, total: 0, applied: 0, responded: 0, interviews: 0, offers: 0 };
    a.total++;
    if (applied(j)) a.applied++;
    if (responded(j)) a.responded++;
    if (interviewed(j)) a.interviews++;
    if (j.status === 'offer') a.offers++;
    m.set(k, a);
  }
  return [...m.values()].sort((a, b) => b.applied - a.applied || b.total - a.total);
}
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

function Breakdown({ title, rows }: { title: string; rows: Agg[] }) {
  const max = Math.max(1, ...rows.map((r) => r.applied));
  return (
    <div class="panel flush table-wrap">
      <div class="panel-head" style="padding:16px 16px 0"><h3>{title}</h3></div>
      <table class="compact wide stats-t">
        <thead><tr><th></th><th>Pronađeno</th><th>Poslato</th><th style="min-width:160px"></th><th>Odgovor</th><th>Intervju</th><th>Stopa odgovora</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td class="job-title">{r.key}</td>
              <td class="mono">{r.total}</td>
              <td class="mono">{r.applied}</td>
              <td><div class="sbar"><span class="a" style={`width:${(r.applied / max) * 100}%`}></span><span class="r" style={`width:${(r.responded / max) * 100}%`}></span></div></td>
              <td class="mono">{r.responded}</td>
              <td class="mono">{r.interviews}</td>
              <td class="mono"><b>{r.applied ? `${pct(r.responded, r.applied)}%` : '—'}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isoWeekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

statsRoutes.get('/stats', async (c) => {
  const user = c.get('user') as SessionUser;
  const { results } = await c.env.DB.prepare(
    `SELECT j.id, j.status, j.source, j.url, j.contract_type, j.level, j.risks, j.applied_at, j.found_at,
            (SELECT count(*) FROM interviews i WHERE i.job_id = j.id) AS n_iv FROM jobs j`,
  ).all<J>();
  const jobs = results ?? [];
  const { results: exp } = await c.env.DB.prepare(
    `SELECT j.id AS job_id, j.company, count(*) AS n, avg(f.feeling) AS feeling,
            avg((coalesce(f.r_respect,0)+coalesce(f.r_prep,0)+coalesce(f.r_clarity,0)+coalesce(f.r_time,0)+coalesce(f.r_comms,0)) * 1.0 /
                nullif((f.r_respect IS NOT NULL)+(f.r_prep IS NOT NULL)+(f.r_clarity IS NOT NULL)+(f.r_time IS NOT NULL)+(f.r_comms IS NOT NULL), 0)) AS score,
            sum(f.would_work = 'yes') AS yes, sum(f.would_work = 'no') AS no, sum(f.red_flags IS NOT NULL AND f.red_flags != '') AS flags
     FROM interview_feedback f JOIN interviews i ON i.id = f.interview_id LEFT JOIN jobs j ON j.id = i.job_id
     GROUP BY j.id ORDER BY score DESC`,
  ).all<{ job_id: number | null; company: string | null; n: number; feeling: number | null; score: number | null; yes: number; no: number; flags: number }>();
  const { results: rejs } = await c.env.DB.prepare(
    `SELECT r.*, j.company, j.title FROM rejections r JOIN jobs j ON j.id = r.job_id ORDER BY coalesce(r.received_on, r.created_at) DESC`,
  ).all<RejectionRow & { company: string; title: string }>();
  const rejList = rejs ?? [];
  const rejGeneric = rejList.filter((r) => r.generic === 1).length;
  const rejOpen = rejList.filter((r) => r.reply_status === 'none').length;
  const tot = aggregate(jobs, () => 'Sve')[0] ?? { key: '', total: 0, applied: 0, responded: 0, interviews: 0, offers: 0 };
  const rejectedAfter = jobs.filter((j) => applied(j) && j.status === 'rejected').length;

  // Applications per week, last 10 weeks
  const weeks: { w: string; n: number }[] = [];
  const now = new Date();
  for (let i = 9; i >= 0; i--) weeks.push({ w: isoWeekStart(new Date(now.getTime() - i * 7 * 86400000)), n: 0 });
  for (const j of jobs) {
    if (!j.applied_at) continue;
    const w = isoWeekStart(new Date(j.applied_at + 'T12:00:00Z'));
    const slot = weeks.find((x) => x.w === w);
    if (slot) slot.n++;
  }
  const wmax = Math.max(1, ...weeks.map((w) => w.n));

  return c.html(
    <Layout title="Statistika" active="stats" user={user}>
      <Topbar crumb={<b>Statistika prijava</b>} />
      <div class="content" style="max-width:1100px">
        <div class="page-head">
          <div>
            <h1>Statistika</h1>
            <div class="sub">Odgovor = intervju, ponuda ili odbijenica posle prijave. Tišina se ne računa kao odgovor.</div>
          </div>
        </div>

        <div class="tiles six-m">
          {[
            ['Pronađeno', tot.total, null],
            ['Poslato', tot.applied, null],
            ['Odgovorili', tot.responded, tot.applied ? `${pct(tot.responded, tot.applied)}% od poslatih` : null],
            ['Intervju', tot.interviews, tot.applied ? `${pct(tot.interviews, tot.applied)}% od poslatih` : null],
            ['Odbijeno', rejectedAfter, null],
            ['Ponuda', tot.offers, null],
          ].map(([l, n, sub]) => (
            <div class="tile" style="--tc:var(--ink)"><div class="num">{n}</div><div class="lbl">{l}</div>{sub && <div class="faint mono" style="font-size:.66rem;margin-top:4px">{sub}</div>}</div>
          ))}
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Poslate prijave po nedeljama</h3></div>
          <div class="wchart">
            {weeks.map((w) => (
              <div class="wcol" title={`${w.n} prijava`}>
                <div class="wn mono">{w.n || ''}</div>
                <div class="wbar" style={`height:${(w.n / wmax) * 100}%`}></div>
                <div class="wl mono">{w.w.slice(8, 10)}.{w.w.slice(5, 7)}.</div>
              </div>
            ))}
          </div>
        </div>

        {rejList.length > 0 && (
          <div class="panel flush table-wrap" style="margin-bottom:16px">
            <div class="panel-head" style="padding:16px 16px 0"><h3>Odbijenice: {rejList.length} · generičkih {rejGeneric} · bez odgovora {rejOpen}</h3></div>
            <table class="compact wide stats-t">
              <thead><tr><th>Firma</th><th>Primljeno</th><th>Faza</th><th>Vrsta</th><th>Odgovor</th></tr></thead>
              <tbody>
                {rejList.map((r) => (
                  <tr>
                    <td><a href={`/jobs/${r.job_id}#odbijenica`} class="job-title">{r.company}</a><div class="job-co">{r.title}</div></td>
                    <td class="mono">{r.received_on ? fmtDate(r.received_on) : '—'}</td>
                    <td>{STAGE_LABEL[r.stage]}</td>
                    <td><span class={`rej-badge ${r.generic ? 'gen' : 'spec'}`}>{r.generic ? 'Generička' : 'Konkretna'}</span></td>
                    <td class={`rej-st rej-${r.reply_status}`}>{REPLY_STATUS_LABEL[r.reply_status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(exp ?? []).length > 0 && (
          <div class="panel flush table-wrap" style="margin-bottom:16px">
            <div class="panel-head" style="padding:16px 16px 0"><h3>Iskustvo sa intervjuima (tvoje ocene)</h3></div>
            <table class="compact wide stats-t">
              <thead><tr><th>Firma</th><th>Intervjua</th><th>Kako si se osećao</th><th>Ocena intervjuera</th><th>Radio bih kod njih</th><th>Red flags</th></tr></thead>
              <tbody>
                {(exp ?? []).map((e) => (
                  <tr>
                    <td class="job-title">{e.job_id ? <a href={`/jobs/${e.job_id}?tab=intervjui`}>{e.company}</a> : '—'}</td>
                    <td class="mono">{e.n}</td>
                    <td>{e.feeling ? FEELINGS[Math.round(e.feeling)] : '—'}</td>
                    <td class="mono"><b>{e.score ? e.score.toFixed(1) : '—'}</b> / 5</td>
                    <td class="mono">{e.yes ? 'da' : e.no ? 'ne' : '—'}</td>
                    <td>{e.flags ? <span class="flag">⚑ {e.flags}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div class="legend" style="margin:0 0 10px"><i class="t-sent"></i>poslato <i class="t-resp"></i>odgovorili</div>
        <div class="stack">
          <Breakdown title="Po izvoru (platforma / ATS)" rows={aggregate(jobs, platform)} />
          <Breakdown title="Po grupi uloga" rows={aggregate(jobs, group)} />
          <Breakdown title="Po tipu ugovora" rows={aggregate(jobs, contract)} />
        </div>
      </div>
    </Layout>,
  );
});
