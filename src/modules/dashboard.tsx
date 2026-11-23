import { Hono } from 'hono';
import { raw } from 'hono/html';
import type { Env, SessionUser, RunRow, JobRow } from '../types';
import { STATUSES, STATUS_LABEL, STATUS_COLOR } from '../types';
import { Layout, Topbar } from '../views/layout';
import { StatusPill, LevelTag, FitBadge, fmtDate, fmtDateTime } from '../views/helpers';
import { renderMarkdown } from '../lib/markdown';
import { statusCounts, followUpsDue, listJobs } from './jobs/service';

type Vars = { user: SessionUser | null };
export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

function JobList({ jobs, empty }: { jobs: JobRow[]; empty: string }) {
  if (!jobs.length) return <div class="faint" style="font-size:.88rem">{empty}</div>;
  return (
    <table class="compact">
      <tbody>
        {jobs.map((j) => (
          <tr>
            <td>
              <a href={`/jobs/${j.id}`} class="job-title">{j.title}</a>
              <div class="job-co">{j.company}</div>
            </td>
            <td><LevelTag level={j.level} /></td>
            <td><FitBadge fit={j.fit} /></td>
            <td><StatusPill status={j.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

dashboardRoutes.get('/', async (c) => {
  const user = c.get('user') as SessionUser;
  const db = c.env.DB;
  const [counts, due, ready, review, lastRun] = await Promise.all([
    statusCounts(db),
    followUpsDue(db),
    listJobs(db, { status: ['ready'] }),
    listJobs(db, { status: ['review'] }),
    db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC, id DESC LIMIT 1').first<RunRow>(),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const active = (counts.applied ?? 0) + (counts.interview ?? 0) + (counts.offer ?? 0);

  return c.html(
    <Layout title="Pregled" active="dashboard" user={user}>
      <Topbar />
      <div class="content">
        <div class="page-head">
          <div>
            <h1>Zdravo, {user.name.split(' ')[0]}</h1>
            <div class="sub">{active} prijava u toku · {(counts.ready ?? 0) + (counts.review ?? 0)} oglasa čeka tebe</div>
          </div>
        </div>

        <div class="tiles seven">
          <div class="tile total" style="--tc:var(--ink)">
            <a href="/jobs">
              <div class="num">{total}</div>
              <div class="lbl">Ukupno</div>
            </a>
          </div>
          {STATUSES.map((s) => (
            <div class="tile" style={`--tc:${STATUS_COLOR[s]}`}>
              <a href={`/jobs?status=${s}`}>
                <div class="num">{counts[s] ?? 0}</div>
                <div class="lbl">{STATUS_LABEL[s]}</div>
              </a>
            </div>
          ))}
        </div>

        <div class="layout" style="grid-template-columns:1fr 1fr">
          <div class="stack">
            <div class="panel">
              <div class="panel-head"><h3>Spremno za slanje</h3><a href="/jobs?status=ready" class="faint mono" style="font-size:.7rem">sve →</a></div>
              <JobList jobs={ready.slice(0, 6)} empty="Nema spremnih paketa." />
            </div>
            <div class="panel">
              <div class="panel-head"><h3>Za pregled</h3><a href="/jobs?status=review" class="faint mono" style="font-size:.7rem">sve →</a></div>
              <JobList jobs={review.slice(0, 6)} empty="Nema novih oglasa za pregled." />
            </div>
          </div>
          <div class="stack">
            <div class="panel">
              <div class="panel-head"><h3>Follow-up danas</h3></div>
              {due.length === 0 ? (
                <div class="faint" style="font-size:.88rem">Nijedan follow-up ne kasni.</div>
              ) : (
                <table class="compact">
                  <tbody>
                    {due.map((j) => (
                      <tr>
                        <td><a href={`/jobs/${j.id}`} class="job-title">{j.title}</a><div class="job-co">{j.company}</div></td>
                        <td class="mono" style="font-size:.74rem">poslato {fmtDate(j.applied_at)}</td>
                        <td class="due over">{fmtDate(j.follow_up_on)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div class="panel">
              <div class="panel-head"><h3>Poslednji rad agenta</h3><a href="/agent" class="faint mono" style="font-size:.7rem">istorija →</a></div>
              {lastRun ? (
                <>
                  <div class="run-stats">
                    <span>{fmtDateTime(lastRun.started_at)}</span>
                    <span><b>{lastRun.added}</b> novih</span>
                    <span><b>{lastRun.closed}</b> zatvorenih</span>
                    <span><b>{lastRun.updated}</b> statusa</span>
                    <span><b>{lastRun.drafts}</b> draftova</span>
                  </div>
                  {lastRun.summary && <div class="prose" style="padding:0">{raw(renderMarkdown(lastRun.summary))}</div>}
                </>
              ) : (
                <div class="faint" style="font-size:.88rem">Agent još nije radio. Prvo pokretanje je sledećeg radnog dana u 7:43.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>,
  );
});
