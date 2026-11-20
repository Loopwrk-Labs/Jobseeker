import { Hono } from 'hono';
import { raw } from 'hono/html';
import type { Env, SessionUser, RunRow } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { fmtDateTime } from '../../views/helpers';
import { renderMarkdown } from '../../lib/markdown';

type Vars = { user: SessionUser | null };
export const agentRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

agentRoutes.get('/agent', async (c) => {
  const user = c.get('user') as SessionUser;
  const { results } = await c.env.DB.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC, id DESC LIMIT 60').all<RunRow>();
  const runs = results ?? [];
  return c.html(
    <Layout title="Agent" active="agent" user={user}>
      <Topbar crumb={<b>Jutarnji agent · istorija rada</b>} />
      <div class="content">
        <div class="page-head">
          <div>
            <h1>Agent</h1>
            <div class="sub">Radi radnim danima u 7:43 na tvom računaru. Ako računar nije upaljen, u 9:17 stiže podsetnik.</div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Šta agent radi sam</h3></div>
          <div class="prose" style="padding:0">
            <ul>
              <li>Čita Gmail i ažurira statuse prijava (potvrda, intervju, odbijenica, ponuda).</li>
              <li>Ponovo proverava otvorene oglase i briše one koji su zatvoreni.</li>
              <li>Traži nove remote oglase, proverava ih na sajtu poslodavca i upisuje samo žive.</li>
              <li>Za oglase sa ocenom 7+ pravi paket: cover letter i CV bulletе.</li>
              <li>Pravi Gmail draftove za follow-up posle 10 dana bez odgovora.</li>
            </ul>
            <p><strong>Nikad ne šalje mejlove, ne klikće Apply i ne popunjava formulare.</strong></p>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Pokretanja</h3></div>
          {runs.length === 0 && <div class="faint" style="font-size:.88rem">Agent još nije radio.</div>}
          {runs.map((r) => (
            <div class="run">
              <div class="mono" style="font-size:.78rem;color:var(--ink)">{fmtDateTime(r.started_at)}</div>
              <div class="run-stats">
                <span><b>{r.added}</b> novih</span>
                <span><b>{r.closed}</b> zatvorenih</span>
                <span><b>{r.updated}</b> statusa</span>
                <span><b>{r.drafts}</b> draftova</span>
              </div>
              {r.summary && <div class="prose" style="padding:0">{raw(renderMarkdown(r.summary))}</div>}
              {r.unverified && (
                <div class="kv-note">
                  <div class="k">Nisam mogao da proverim</div>
                  <div class="prose" style="padding:0">{raw(renderMarkdown(r.unverified))}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Layout>,
  );
});
