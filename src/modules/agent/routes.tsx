import { Hono } from 'hono';
import { raw } from 'hono/html';
import type { Env, SessionUser, RunRow } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { fmtDateTime } from '../../views/helpers';
import { renderMarkdown } from '../../lib/markdown';
import { TASKS } from '../../lib/claude';
import { getFire, saveFire, fire, validUrl, type Which } from './fire';

type Vars = { user: SessionUser | null };
export const agentRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

agentRoutes.get('/agent', async (c) => {
  const user = c.get('user') as SessionUser;
  const { results } = await c.env.DB.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC, id DESC LIMIT 60').all<RunRow>();
  const runs = results ?? [];
  const [gmailCfg, agentCfg] = await Promise.all([getFire(c.env.DB, 'gmail'), getFire(c.env.DB, 'agent')]);
  const f = c.req.query('fired');
  const fired = f
    ? f === 'ok'
      ? { ok: true, text: c.req.query('w') === 'gmail' ? '✓ Brza Gmail provera je pokrenuta. Rezime stiže kao notifikacija.' : '✓ Agent je pokrenut na tvom MacBooku.', url: c.req.query('s') ?? null }
      : f === 'setup'
        ? { ok: true, text: '✓ Sačuvano. Dugme sada radi jednim klikom.', url: null }
        : { ok: false, text: c.req.query('msg') ?? 'Nije uspelo.', url: null }
    : null;
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
        <div class="panel" id="run">
          <div class="panel-head"><h3>Pokreni sada</h3></div>
          {fired && <div class={`run-flash ${fired.ok ? 'ok' : 'err'}`}>{fired.text}{fired.url && <> · <a href={fired.url} target="_blank" rel="noopener noreferrer">prati sesiju ↗</a></>}</div>}
          <div class="run-now">
            {([['gmail', 'Brza Gmail provera', 'Čita mejl i ažurira statuse, intervjue i kontakte. Radi u cloudu, oko minut.'], ['agent', 'Ceo agent', 'Mejl, provera oglasa, nova pretraga i paketi. Radi na tvom MacBooku, 15–40 min.']] as const).map(([w, title, desc]) => {
              const cfg = w === 'gmail' ? gmailCfg : agentCfg;
              return (
                <div class="run-card">
                  <div class="mat-title">{title}</div>
                  <div class="faint" style="font-size:.86rem">{desc}</div>
                  {cfg ? (
                    <form method="post" action={`/agent/fire/${w}`} class="run-form">
                      <input type="hidden" name="back" value="/agent#run" />
                      {w === 'agent' && <input name="text" placeholder="Opciono: fokus ovog pokretanja" />}
                      <button type="submit" class="btn btn-solid btn-sm" data-busy="Pokrećem…">{w === 'gmail' ? 'Proveri mejl' : 'Pokreni agenta'}</button>
                    </form>
                  ) : (
                    <div class="faint" style="font-size:.82rem;margin-top:10px">Nije povezano. Vidi korake ispod.</div>
                  )}
                </div>
              );
            })}
          </div>
          <details class="run-setup" open={!gmailCfg || !agentCfg}>
            <summary class="panel-sum">{gmailCfg && agentCfg ? 'Podešavanje dugmića' : 'Poveži dugmiće (jednom, 2 minuta)'}</summary>
            <ol class="steps-ol" style="margin-top:10px">
              <li>Otvori <a href="https://claude.ai/code/routines" target="_blank" rel="noopener noreferrer">claude.ai/code/routines</a> i izaberi zadatak „{TASKS.gmail.name}“.</li>
              <li><b>Add another trigger → API</b>, sačuvaj, pa <b>Generate token</b>. Kopiraj URL i token (token se prikazuje samo jednom).</li>
              <li>Nalepi ih ispod. Isto ponovi za „{TASKS.agent.name}“.</li>
            </ol>
            {(['gmail', 'agent'] as const).map((w) => {
              const cfg = w === 'gmail' ? gmailCfg : agentCfg;
              return (
                <form method="post" action={`/agent/fire/${w}/setup`} class="fire-setup">
                  <div class="k">{w === 'gmail' ? TASKS.gmail.name : TASKS.agent.name} {cfg && <span class="tag-default">povezano</span>}</div>
                  <input name="url" placeholder="https://api.anthropic.com/v1/claude_code/routines/…/fire" value={cfg?.url ?? ''} />
                  <input name="token" type="password" placeholder={cfg ? 'token je sačuvan (nalepi novi da ga zameniš)' : 'sk-ant-oat01-…'} autocomplete="off" />
                  <button class="btn btn-line btn-sm" type="submit">Sačuvaj</button>
                  {cfg && <button class="btn btn-line btn-sm" type="submit" formaction={`/agent/fire/${w}/remove`}>Ukloni</button>}
                </form>
              );
            })}
            <div class="faint" style="font-size:.78rem;margin-top:8px">Token može samo da pokrene taj jedan zadatak; ne daje pristup nalogu. Čuva se u tvojoj bazi.</div>
          </details>
        </div>

        <div class="panel" id="pushBox">
          <div class="panel-head"><h3>Notifikacije na telefonu</h3></div>
          <div class="faint" style="font-size:.86rem;margin-bottom:10px">Javljam kad agent upiše intervju, odbijenicu, ponudu ili nove oglase, 1 h pre intervjua i jutarnji pregled u 8h. Na iPhone-u prvo dodaj Jobseeker na početni ekran (Safari → Share → Add to Home Screen), pa uključi ovde iz te aplikacije.</div>
          <div class="inline-actions">
            <button type="button" class="btn btn-solid btn-sm" id="pushBtn">Uključi notifikacije na ovom uređaju</button>
            <button type="button" class="btn btn-line btn-sm" id="pushTest" hidden>Pošalji probnu</button>
          </div>
          <div class="faint" id="pushMsg" style="font-size:.82rem;margin-top:8px"></div>
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

const isWhich = (w: string): w is Which => w === 'gmail' || w === 'agent';
const backOf = (v: unknown, d: string) => {
  const b = String(v ?? '');
  return b.startsWith('/') ? b : d;
};
const withQ = (b: string, q: string) => {
  const [path, hash] = b.split('#');
  return `${path}${path.includes('?') ? '&' : '?'}${q}${hash ? `#${hash}` : ''}`;
};

agentRoutes.post('/agent/fire/:w', async (c) => {
  const w = c.req.param('w');
  if (!isWhich(w)) return c.redirect('/agent');
  const b = await c.req.parseBody();
  const back = backOf(b.back, '/agent#run');
  const text = String(b.text ?? '').trim().slice(0, 2000) || null;
  const r = await fire(c.env.DB, w, text ? `Dodatna poruka za ovo pokretanje: ${text}` : null);
  if (!r.ok && r.error === 'not_configured') return c.redirect('/agent#run');
  const q = r.ok ? `fired=ok&w=${w}${r.sessionUrl ? `&s=${encodeURIComponent(r.sessionUrl)}` : ''}` : `fired=err&msg=${encodeURIComponent(r.error)}`;
  return c.redirect(withQ(back, q));
});

agentRoutes.post('/agent/fire/:w/setup', async (c) => {
  const w = c.req.param('w');
  if (!isWhich(w)) return c.redirect('/agent');
  const b = await c.req.parseBody();
  const url = String(b.url ?? '').trim();
  const token = String(b.token ?? '').trim();
  const old = await getFire(c.env.DB, w);
  if (!validUrl(url)) return c.redirect(`/agent?fired=err&msg=${encodeURIComponent('URL nije ispravan. Treba da izgleda kao https://api.anthropic.com/v1/claude_code/routines/…/fire')}#run`);
  const tok = token || old?.token;
  if (!tok) return c.redirect(`/agent?fired=err&msg=${encodeURIComponent('Nalepi i token.')}#run`);
  await saveFire(c.env.DB, w, { url, token: tok, savedAt: new Date().toISOString() });
  return c.redirect('/agent?fired=setup#run');
});

agentRoutes.post('/agent/fire/:w/remove', async (c) => {
  const w = c.req.param('w');
  if (isWhich(w)) await saveFire(c.env.DB, w, null);
  return c.redirect('/agent#run');
});
