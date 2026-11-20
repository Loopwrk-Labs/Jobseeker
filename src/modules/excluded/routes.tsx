import { Hono } from 'hono';
import type { Env, SessionUser, ExcludedRow } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { Flash, safeUrl, hostOf, fmtDate } from '../../views/helpers';

type Vars = { user: SessionUser | null };
export const excludedRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

excludedRoutes.get('/excluded', async (c) => {
  const user = c.get('user') as SessionUser;
  const { results } = await c.env.DB.prepare('SELECT * FROM excluded ORDER BY created_at DESC, id DESC').all<ExcludedRow>();
  const rows = results ?? [];
  const ok = c.req.query('ok');
  return c.html(
    <Layout title="Izbačeni" active="excluded" user={user}>
      <Topbar crumb={<b>Izbačeni oglasi · agent ih ne vraća</b>} />
      <div class="content">
        {ok === 'added' && <Flash>Dodato na listu.</Flash>}
        {ok === 'removed' && <Flash>Uklonjeno sa liste. Agent može ponovo da nađe ovaj oglas.</Flash>}
        <div class="page-head">
          <div>
            <h1>Izbačeni</h1>
            <div class="sub">{rows.length} na listi. Agent čita ovu listu pre svakog upisa i preskače sve što je ovde.</div>
          </div>
        </div>
        <form method="post" action="/excluded" class="panel">
          <div class="form-grid three">
            <div class="field"><label>Firma *</label><input name="company" required /></div>
            <div class="field"><label>Pozicija (prazno = cela firma)</label><input name="title" /></div>
            <div class="field"><label>Razlog</label><input name="reason" /></div>
          </div>
          <div class="form-actions"><button type="submit" class="btn btn-solid btn-sm">Dodaj na listu</button></div>
        </form>
        <div class="panel flush table-wrap">
          <table class="compact">
            <thead><tr><th>Firma</th><th>Pozicija</th><th>Razlog</th><th>Link</th><th>Dodato</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colspan={6} class="faint">Lista je prazna.</td></tr>}
              {rows.map((r) => (
                <tr>
                  <td class="job-title">{r.company}</td>
                  <td>{r.title ?? <span class="faint">cela firma</span>}</td>
                  <td class="wrap">{r.reason ?? '—'}</td>
                  <td>{safeUrl(r.url) ? <a class="host" href={safeUrl(r.url)!} target="_blank" rel="noopener noreferrer">{hostOf(r.url)} ↗</a> : '—'}</td>
                  <td class="mono" style="font-size:.74rem">{fmtDate(r.created_at)}</td>
                  <td>
                    <form method="post" action={`/excluded/${r.id}/delete`}>
                      <button class="btn btn-line btn-sm" type="submit">Vrati</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>,
  );
});

excludedRoutes.post('/excluded', async (c) => {
  const b = await c.req.parseBody();
  const company = String(b.company ?? '').trim();
  if (company) {
    const t = String(b.title ?? '').trim() || null;
    const r = String(b.reason ?? '').trim() || null;
    await c.env.DB.prepare('INSERT INTO excluded (company, title, reason) VALUES (?, ?, ?)').bind(company, t, r).run();
  }
  return c.redirect('/excluded?ok=added');
});

excludedRoutes.post('/excluded/:id/delete', async (c) => {
  await c.env.DB.prepare('DELETE FROM excluded WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.redirect('/excluded?ok=removed');
});
