import { Hono } from 'hono';
import { raw } from 'hono/html';
import type { Env, SessionUser } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { Flash, fmtDateTime } from '../../views/helpers';
import { renderMarkdown } from '../../lib/markdown';
import { getSetting, setSetting } from '../settings/service';

type Vars = { user: SessionUser | null };
export const profileRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const SECTIONS = [
  { key: 'profile', title: 'Profil (iz CV-ja)', hint: 'Agent piše cover lettere i CV bulletе samo iz ovoga. Ništa što ovde ne piše ne sme da izmisli.' },
  { key: 'criteria', title: 'Kriterijumi pretrage', hint: 'Uloge, nivoi, lokacija, domeni i pravila koja agent primenjuje svako jutro.' },
] as const;

profileRoutes.get('/profile', async (c) => {
  const user = c.get('user') as SessionUser;
  const edit = c.req.query('edit');
  const ok = c.req.query('ok');
  const data = await Promise.all(SECTIONS.map((s) => getSetting(c.env.DB, s.key)));
  return c.html(
    <Layout title="Profil i kriterijumi" active="profile" user={user}>
      <Topbar crumb={<b>Profil i kriterijumi · agent čita odavde</b>} />
      <div class="content" style="max-width:1000px">
        {ok && <Flash>Sačuvano. Agent koristi novu verziju od sledećeg pokretanja.</Flash>}
        <div class="page-head">
          <div>
            <h1>Profil i kriterijumi</h1>
            <div class="sub">Agent pre svakog rada čita ove dve sekcije iz baze.</div>
          </div>
        </div>
        {SECTIONS.map((s, i) => (
          <div class="panel" id={s.key}>
            <div class="panel-head">
              <h3>{s.title}</h3>
              <span class="inline-actions">
                {data[i] && <span class="faint mono" style="font-size:.68rem">izmenjeno {fmtDateTime(data[i]!.updated_at)}</span>}
                {edit !== s.key && <a href={`/profile?edit=${s.key}#${s.key}`} class="btn btn-line btn-sm">Izmeni</a>}
              </span>
            </div>
            <div class="faint" style="font-size:.84rem;margin-bottom:12px">{s.hint}</div>
            {edit === s.key ? (
              <form method="post" action={`/profile/${s.key}`}>
                <textarea name="value" class="md-edit field" style="padding:12px;background:var(--surface-2);border:1px solid var(--hairline-strong);border-radius:4px;color:var(--ink)">{data[i]?.value ?? ''}</textarea>
                <div class="form-actions">
                  <a href={`/profile#${s.key}`} class="btn btn-line btn-sm">Otkaži</a>
                  <button type="submit" class="btn btn-solid btn-sm">Sačuvaj</button>
                </div>
              </form>
            ) : data[i] ? (
              <div class="prose" style="padding:0">{raw(renderMarkdown(data[i]!.value))}</div>
            ) : (
              <div class="faint">Prazno.</div>
            )}
          </div>
        ))}
      </div>
    </Layout>,
  );
});

profileRoutes.post('/profile/:key', async (c) => {
  const key = c.req.param('key');
  if (!SECTIONS.some((s) => s.key === key)) return c.text('Nepoznato.', 404);
  const body = await c.req.parseBody();
  await setSetting(c.env.DB, key, String(body.value ?? '').replace(/\r\n/g, '\n'));
  return c.redirect(`/profile?ok=1#${key}`);
});
