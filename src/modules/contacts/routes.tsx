import { Hono } from 'hono';
import type { Env, SessionUser } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { Flash, safeUrl, fmtDate, fmtDateTime } from '../../views/helpers';

type Vars = { user: SessionUser | null };
export const contactRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

export interface ContactRow {
  id: number;
  name: string;
  role: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  job_id: number | null;
  notes: string | null;
  source: string;
  updated_at: string;
  job_title?: string | null;
  last_at?: string | null;
  n_events?: number;
}
export interface ContactEventRow {
  id: number;
  contact_id: number;
  at: string;
  channel: string | null;
  direction: string | null;
  summary: string;
  actor: string;
}

const s = (v: unknown) => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};
const CHANNELS = [['email', 'Mejl'], ['call', 'Poziv'], ['interview', 'Intervju'], ['linkedin', 'LinkedIn'], ['other', 'Drugo']] as const;
const chLabel = (c: string | null) => CHANNELS.find(([k]) => k === c)?.[1] ?? c ?? '';

export async function jobContacts(db: D1Database, jobId: number, company: string): Promise<ContactRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM contacts WHERE job_id = ? OR (job_id IS NULL AND lower(company) = lower(?)) ORDER BY name')
    .bind(jobId, company)
    .all<ContactRow>();
  return results ?? [];
}

export function ContactForm({ r, jobId, company, back, jobs }: { r?: ContactRow; jobId?: number; company?: string; back: string; jobs?: { id: number; company: string; title: string }[] }) {
  return (
    <form method="post" action={r ? `/contacts/${r.id}` : '/contacts'}>
      <input type="hidden" name="back" value={back} />
      <div class="form-grid four">
        <div class="field"><label>Ime *</label><input name="name" required value={r?.name ?? ''} /></div>
        <div class="field"><label>Uloga</label><input name="role" placeholder="Recruiter, Hiring manager…" value={r?.role ?? ''} /></div>
        <div class="field"><label>Firma</label><input name="company" value={r?.company ?? company ?? ''} /></div>
        <div class="field"><label>Email</label><input name="email" type="email" value={r?.email ?? ''} /></div>
      </div>
      <div class="form-grid four">
        <div class="field"><label>Telefon</label><input name="phone" value={r?.phone ?? ''} /></div>
        <div class="field"><label>LinkedIn</label><input name="linkedin" placeholder="https://linkedin.com/in/…" value={r?.linkedin ?? ''} /></div>
        {jobs ? (
          <div class="field">
            <label>Posao</label>
            <select name="job_id">
              <option value="">—</option>
              {jobs.map((j) => <option value={j.id} selected={r?.job_id === j.id}>{j.company} · {j.title}</option>)}
            </select>
          </div>
        ) : (
          <input type="hidden" name="job_id" value={r?.job_id ?? jobId ?? ''} />
        )}
        <div class="field"><label>Beleška</label><input name="notes" value={r?.notes ?? ''} /></div>
      </div>
      <div class="form-actions"><button type="submit" class="btn btn-solid btn-sm">Sačuvaj kontakt</button></div>
    </form>
  );
}

export function ContactChip({ r }: { r: ContactRow }) {
  return (
    <a href={`/contacts/${r.id}`} class="contact-chip">
      <span class="avatar sm">{r.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}</span>
      <span><b>{r.name}</b><span class="faint">{r.role ? ` · ${r.role}` : ''}</span></span>
    </a>
  );
}

contactRoutes.get('/contacts', async (c) => {
  const user = c.get('user') as SessionUser;
  const q = (c.req.query('q') ?? '').trim();
  const like = `%${q}%`;
  const sql = `SELECT c.*, j.title AS job_title, (SELECT max(at) FROM contact_events e WHERE e.contact_id = c.id) AS last_at,
               (SELECT count(*) FROM contact_events e WHERE e.contact_id = c.id) AS n_events
               FROM contacts c LEFT JOIN jobs j ON j.id = c.job_id
               ${q ? 'WHERE c.name LIKE ?1 OR c.company LIKE ?1 OR c.email LIKE ?1 OR c.role LIKE ?1' : ''}
               ORDER BY coalesce(last_at, c.updated_at) DESC LIMIT 300`;
  const [{ results }, jobsRes] = await Promise.all([
    c.env.DB.prepare(sql).bind(...(q ? [like] : [])).all<ContactRow>(),
    c.env.DB.prepare("SELECT id, company, title FROM jobs WHERE status != 'rejected' ORDER BY company").all<{ id: number; company: string; title: string }>(),
  ]);
  const rows = results ?? [];
  const ok = c.req.query('ok');
  return c.html(
    <Layout title="Kontakti" active="contacts" user={user}>
      <Topbar crumb={<b>Kontakti · recruiter-i i ljudi u firmama</b>} />
      <div class="content" style="max-width:1100px">
        {ok && <Flash>{ok === 'del' ? 'Kontakt je obrisan.' : 'Kontakt je sačuvan.'}</Flash>}
        <div class="page-head">
          <div>
            <h1>Kontakti</h1>
            <div class="sub">{rows.length} kontakata. Agent dodaje ljude koji ti pišu u vezi sa prijavama i beleži komunikaciju.</div>
          </div>
        </div>
        <details class="panel">
          <summary class="panel-sum">+ Novi kontakt</summary>
          <div style="margin-top:12px"><ContactForm back="/contacts" jobs={jobsRes.results ?? []} /></div>
        </details>
        <form method="get" action="/contacts" class="search-row">
          <input name="q" value={q} placeholder="Traži po imenu, firmi, mejlu…" />
          <button class="btn btn-line btn-sm" type="submit">Traži</button>
        </form>
        <div class="panel flush table-wrap">
          <table class="compact wide">
            <thead><tr><th>Ime</th><th>Firma</th><th>Posao</th><th>Kontakt</th><th>Poslednja komunikacija</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colspan={5} class="faint">{q ? 'Ništa ne odgovara pretrazi.' : 'Još nema kontakata.'}</td></tr>}
              {rows.map((r) => (
                <tr>
                  <td><a href={`/contacts/${r.id}`} class="job-title">{r.name}</a><div class="job-co">{r.role ?? ''}</div></td>
                  <td>{r.company ?? '—'}</td>
                  <td>{r.job_id ? <a href={`/jobs/${r.job_id}`}>{r.job_title}</a> : '—'}</td>
                  <td class="mono" style="font-size:.76rem">{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : ''}{r.linkedin && safeUrl(r.linkedin) ? <> <a href={safeUrl(r.linkedin)!} target="_blank" rel="noopener noreferrer">in ↗</a></> : ''}</td>
                  <td class="mono" style="font-size:.76rem">{r.last_at ? `${fmtDate(r.last_at)} · ${r.n_events}×` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>,
  );
});

contactRoutes.get('/contacts/:id', async (c) => {
  const user = c.get('user') as SessionUser;
  const id = Number(c.req.param('id'));
  const r = await c.env.DB.prepare('SELECT c.*, j.title AS job_title FROM contacts c LEFT JOIN jobs j ON j.id = c.job_id WHERE c.id = ?').bind(id).first<ContactRow>();
  if (!r) return c.text('Kontakt ne postoji.', 404);
  const [{ results }, jobsRes] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM contact_events WHERE contact_id = ? ORDER BY at DESC, id DESC').bind(id).all<ContactEventRow>(),
    c.env.DB.prepare("SELECT id, company, title FROM jobs ORDER BY company").all<{ id: number; company: string; title: string }>(),
  ]);
  const events = results ?? [];
  const li = r.linkedin && safeUrl(r.linkedin);
  return c.html(
    <Layout title={r.name} active="contacts" user={user}>
      <Topbar crumb={<><a href="/contacts">Kontakti</a> / <b>{r.name}</b></>} />
      <div class="content" style="max-width:1000px">
        {c.req.query('ok') && <Flash>Sačuvano.</Flash>}
        <div class="job-head">
          <div class="job-head-main">
            <div class="job-co-line">{r.company ?? 'Bez firme'}</div>
            <h1>{r.name}</h1>
            <div class="job-meta faint">{[r.role, r.job_id ? null : null].filter(Boolean).join(' · ')}{r.job_id && <> · <a href={`/jobs/${r.job_id}`}>{r.job_title}</a></>}</div>
          </div>
          <div class="inline-actions">
            {r.email && <a href={`mailto:${r.email}`} class="btn btn-line btn-sm">Mejl</a>}
            {li && <a href={li} target="_blank" rel="noopener noreferrer" class="btn btn-line btn-sm">LinkedIn ↗</a>}
          </div>
        </div>
        <div class="layout">
          <div class="stack">
            <div class="panel">
              <div class="panel-head"><h3>Istorija komunikacije</h3></div>
              <form method="post" action={`/contacts/${id}/events`} class="ce-form">
                <select name="channel">{CHANNELS.map(([k, l]) => <option value={k}>{l}</option>)}</select>
                <select name="direction"><option value="out">ja → njima</option><option value="in">oni → meni</option></select>
                <input type="date" name="at" />
                <input name="summary" required placeholder="Šta je rečeno ili poslato…" />
                <button class="btn btn-solid btn-sm" type="submit">Dodaj</button>
              </form>
              {events.length === 0 && <div class="faint" style="font-size:.86rem;margin-top:10px">Još nema zapisa.</div>}
              {events.map((e) => (
                <div class="ev">
                  <div class="who">{fmtDateTime(e.at)}<br />{chLabel(e.channel)} {e.direction === 'in' ? '←' : e.direction === 'out' ? '→' : ''}</div>
                  <div class="body">{e.summary}<div class="faint mono" style="font-size:.66rem;margin-top:2px">{e.actor}</div></div>
                </div>
              ))}
            </div>
          </div>
          <div class="stack">
            <div class="panel">
              <div class="side-field"><div class="k">Email</div><div class="v">{r.email ?? '—'}</div></div>
              <div class="side-field"><div class="k">Telefon</div><div class="v">{r.phone ?? '—'}</div></div>
              <div class="side-field"><div class="k">Beleška</div><div class="v">{r.notes ?? '—'}</div></div>
              <div class="side-field" style="margin:0"><div class="k">Izvor</div><div class="v">{r.source === 'agent' ? 'Agent (Gmail)' : 'Ručno'}</div></div>
            </div>
            <details class="panel">
              <summary class="panel-sum">Izmeni kontakt</summary>
              <div style="margin-top:12px"><ContactForm r={r} back={`/contacts/${id}`} jobs={jobsRes.results ?? []} /></div>
            </details>
            <details class="panel danger-zone">
              <summary>Obriši kontakt</summary>
              <form method="post" action={`/contacts/${id}/delete`} style="margin-top:12px" onsubmit="return confirm('Obrisati kontakt i njegovu istoriju?')">
                <button type="submit" class="btn btn-danger btn-sm" style="width:100%;justify-content:center">Obriši</button>
              </form>
            </details>
          </div>
        </div>
      </div>
    </Layout>,
  );
});

async function saveContact(c: any, id: number | null) {
  const b = await c.req.parseBody();
  const name = s(b.name);
  const back = s(b.back);
  const target = back && back.startsWith('/') ? back : '/contacts';
  if (!name) return c.redirect(target);
  const li = s(b.linkedin);
  const vals = [name, s(b.role), s(b.company), s(b.email), s(b.phone), li && safeUrl(li) ? li : null, Number(b.job_id) || null, s(b.notes)];
  if (id) await c.env.DB.prepare(`UPDATE contacts SET name=?, role=?, company=?, email=?, phone=?, linkedin=?, job_id=?, notes=?, updated_at=datetime('now') WHERE id=?`).bind(...vals, id).run();
  else await c.env.DB.prepare('INSERT INTO contacts (name, role, company, email, phone, linkedin, job_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(...vals).run();
  return c.redirect(target + (target.includes('?') ? '&' : '?') + 'ok=ct');
}
contactRoutes.post('/contacts', (c) => saveContact(c, null));
contactRoutes.post('/contacts/:id', (c) => saveContact(c, Number(c.req.param('id'))));
contactRoutes.post('/contacts/:id/delete', async (c) => {
  await c.env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.redirect('/contacts?ok=del');
});
contactRoutes.post('/contacts/:id/events', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const summary = s(b.summary);
  if (summary) {
    const at = /^\d{4}-\d{2}-\d{2}$/.test(String(b.at ?? '')) ? `${b.at} 12:00:00` : null;
    const user = c.get('user') as SessionUser;
    await c.env.DB.prepare(`INSERT INTO contact_events (contact_id, at, channel, direction, summary, actor) VALUES (?, coalesce(?, datetime('now')), ?, ?, ?, ?)`)
      .bind(id, at, s(b.channel), s(b.direction), summary, user.name).run();
    await c.env.DB.prepare(`UPDATE contacts SET updated_at=datetime('now') WHERE id=?`).bind(id).run();
  }
  return c.redirect(`/contacts/${id}`);
});
