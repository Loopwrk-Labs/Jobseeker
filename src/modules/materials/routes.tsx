import { Hono } from 'hono';
import type { Env, SessionUser } from '../../types';
import { Layout, Topbar } from '../../views/layout';
import { Flash, fmtDate } from '../../views/helpers';
import { AskClaude, PROMPTS } from '../../lib/claude';
import { raw } from 'hono/html';
import { renderMarkdown } from '../../lib/markdown';

type Vars = { user: SessionUser | null };
export const materialsRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

export interface CvRow {
  id: number;
  name: string;
  focus: string | null;
  content: string | null;
  file_name: string | null;
  file_type: string | null;
  has_file: number;
  size: number | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}
export interface StoryRow {
  id: number;
  title: string;
  tags: string | null;
  situation: string | null;
  task: string | null;
  action: string | null;
  result: string | null;
  source: string;
  updated_at: string;
}
export interface AnswerRow {
  id: number;
  question: string;
  answer: string;
  tags: string | null;
  job_id: number | null;
  company: string | null;
  source: string;
  updated_at: string;
}

const MAX_FILE = 1_500_000;
const s = (v: unknown) => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};

const TABS = [
  ['cv', 'CV verzije'],
  ['stories', 'STAR priče'],
  ['answers', 'Biblioteka odgovora'],
] as const;
type Tab = (typeof TABS)[number][0];

const OK: Record<string, string> = {
  cv: 'CV je sačuvan.',
  cvdel: 'CV verzija je obrisana.',
  story: 'Priča je sačuvana.',
  storydel: 'Priča je obrisana.',
  ans: 'Odgovor je sačuvan.',
  ansdel: 'Odgovor je obrisan.',
  big: 'PDF je veći od 1,5 MB, nije sačuvan. Tekst jeste.',
};

export async function listCvs(db: D1Database): Promise<CvRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, focus, content, file_name, file_type, (file_data IS NOT NULL) AS has_file, length(file_data) AS size,
              is_default, created_at, updated_at FROM cv_versions ORDER BY is_default DESC, name`,
    )
    .all<CvRow>();
  return results ?? [];
}

function tagList(t: string | null): string[] {
  return (t ?? '').split(',').map((x) => x.trim()).filter(Boolean);
}

materialsRoutes.get('/materials', async (c) => {
  const user = c.get('user') as SessionUser;
  const q = c.req.query('tab');
  const tab: Tab = (TABS.find(([k]) => k === q)?.[0] ?? 'cv') as Tab;
  const ok = c.req.query('ok');
  const edit = Number(c.req.query('edit') || 0);
  const search = (c.req.query('q') ?? '').trim();
  const tag = (c.req.query('tag') ?? '').trim();

  let body: any = null;

  if (tab === 'cv') {
    const cvs = await listCvs(c.env.DB);
    const editing = cvs.find((x) => x.id === edit);
    body = (
      <>
        <div class="panel">
          <div class="panel-head">
            <h3>{editing ? `Izmeni: ${editing.name}` : 'Nova CV verzija'}</h3>
          </div>
          <form method="post" action={editing ? `/materials/cv/${editing.id}` : '/materials/cv'} enctype="multipart/form-data" id="cvForm">
            <div class="form-grid">
              <div class="field"><label>Naziv *</label><input name="name" required placeholder="npr. Head of Delivery, Mid PM, Quickbase" value={editing?.name ?? ''} /></div>
              <div class="field"><label>Kada je koristiti (agent čita ovo)</label><input name="focus" placeholder="npr. head/senior delivery i implementation uloge" value={editing?.focus ?? ''} /></div>
            </div>
            <div class="field">
              <label>PDF {editing?.has_file ? '(prazno = zadrži postojeći)' : ''}</label>
              <input type="file" name="file" accept="application/pdf,.pdf" id="cvFile" />
              <div class="faint" id="cvStatus" style="font-size:.8rem;margin-top:4px">Tekst iz PDF-a se izvuče automatski u polje ispod.</div>
            </div>
            <div class="cv-editor">
              <div class="field">
                <label>CV (Markdown: # ime, ## sekcija, ### firma — datumi, - stavka)</label>
                <textarea name="content" id="cvText" rows={18} class="mono-ta">{editing?.content ?? ''}</textarea>
              </div>
              <div class="field">
                <label>Pregled</label>
                <div id="cvPreview" class="cv-doc prose"></div>
              </div>
            </div>
            <label class="check"><input type="checkbox" name="is_default" value="1" checked={!!editing?.is_default || (!editing && cvs.length === 0)} /> Podrazumevana verzija</label>
            <div class="form-actions">
              {editing && <a href="/materials" class="btn btn-line btn-sm">Otkaži</a>}
              <button type="submit" class="btn btn-solid btn-sm">Sačuvaj</button>
            </div>
          </form>
        </div>
        {cvs.length === 0 ? (
          <div class="panel"><div class="faint">Još nema CV verzija. Dodaj PDF iznad; agent posle bira pravu verziju za svaki oglas.</div></div>
        ) : (
          <div class="mat-grid cvs">
            {cvs.map((cv) => (
              <div class="panel mat-card">
                <div class="mat-top">
                  <div>
                    <div class="mat-title">{cv.name} {cv.is_default ? <span class="tag-default">podrazumevani</span> : null}</div>
                    <div class="faint" style="font-size:.84rem">{cv.focus ?? 'Bez opisa kada se koristi'}</div>
                  </div>
                </div>
                <div class="mat-meta mono">
                  {cv.has_file ? <a href={`/materials/cv/${cv.id}/file`}>{cv.file_name ?? 'CV.pdf'} ↓</a> : <span>bez PDF-a</span>}
                  <span>{cv.content ? `${cv.content.length.toLocaleString('sr-RS')} znakova teksta` : 'bez teksta'}</span>
                  <span>izmenjen {fmtDate(cv.updated_at)}</span>
                </div>
                {cv.content && (
                  <details class="cv-view">
                    <summary class="panel-sum">Pregled CV-a</summary>
                    <div class="cv-doc prose">{raw(renderMarkdown(cv.content))}</div>
                  </details>
                )}
                <div class="mat-actions">
                  <AskClaude prompt={PROMPTS.cvFormat(cv.id)} label="Sredi sa Claude-om" />
                  <AskClaude prompt={PROMPTS.cv(cv.id)} label="Popuni profil iz CV-a" />
                  <a href={`/materials?edit=${cv.id}`} class="btn btn-line btn-sm">Izmeni</a>
                  <form method="post" action={`/materials/cv/${cv.id}/delete`} onsubmit="return confirm('Obrisati ovu CV verziju?')">
                    <button class="btn btn-line btn-sm" type="submit">Obriši</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
        <script type="module" src="/cv-upload.js"></script>
      </>
    );
  }

  if (tab === 'stories') {
    const { results } = await c.env.DB.prepare('SELECT * FROM stories ORDER BY updated_at DESC, id DESC').all<StoryRow>();
    const all = results ?? [];
    const tags = [...new Set(all.flatMap((x) => tagList(x.tags)))].sort();
    const rows = tag ? all.filter((x) => tagList(x.tags).includes(tag)) : all;
    const editing = all.find((x) => x.id === edit);
    body = (
      <>
        <div class="panel">
          <div class="panel-head">
            <h3>{editing ? 'Izmeni priču' : 'Nova STAR priča'}</h3>
            {!editing && <AskClaude prompt={PROMPTS.stories()} label="Neka Claude predloži priče" />}
          </div>
          <form method="post" action={editing ? `/materials/stories/${editing.id}` : '/materials/stories'}>
            <div class="form-grid">
              <div class="field"><label>Naslov *</label><input name="title" required placeholder="npr. Go-live pod pritiskom za US lanac" value={editing?.title ?? ''} /></div>
              <div class="field"><label>Tagovi (zarezom)</label><input name="tags" placeholder="liderstvo, konflikt, isporuka" value={editing?.tags ?? ''} /></div>
            </div>
            <div class="form-grid">
              <div class="field"><label>S – Situacija</label><textarea name="situation" rows={3}>{editing?.situation ?? ''}</textarea></div>
              <div class="field"><label>T – Zadatak</label><textarea name="task" rows={3}>{editing?.task ?? ''}</textarea></div>
            </div>
            <div class="form-grid">
              <div class="field"><label>A – Akcija</label><textarea name="action" rows={4}>{editing?.action ?? ''}</textarea></div>
              <div class="field"><label>R – Rezultat</label><textarea name="result" rows={4}>{editing?.result ?? ''}</textarea></div>
            </div>
            <div class="form-actions">
              {editing && <a href="/materials?tab=stories" class="btn btn-line btn-sm">Otkaži</a>}
              <button type="submit" class="btn btn-solid btn-sm">Sačuvaj</button>
            </div>
          </form>
        </div>
        {tags.length > 0 && (
          <div class="chips" style="margin-bottom:12px">
            <a href="/materials?tab=stories" class="chip" style={!tag ? 'border-color:var(--ink);color:var(--ink)' : ''}>Sve ({all.length})</a>
            {tags.map((t) => <a href={`/materials?tab=stories&tag=${encodeURIComponent(t)}`} class="chip" style={tag === t ? 'border-color:var(--ink);color:var(--ink)' : ''}>{t}</a>)}
          </div>
        )}
        {rows.length === 0 && <div class="panel"><div class="faint">Još nema priča. Dodaj ručno ili pusti Claude da predloži iz tvog profila.</div></div>}
        <div class="stack">
          {rows.map((st) => {
            const text = `${st.title}\n\nSituation: ${st.situation ?? ''}\nTask: ${st.task ?? ''}\nAction: ${st.action ?? ''}\nResult: ${st.result ?? ''}`;
            return (
              <div class="panel story">
                <div class="mat-top">
                  <div>
                    <div class="mat-title">{st.title}</div>
                    <div class="story-tags">{tagList(st.tags).map((t) => <span class="chip-s">{t}</span>)}{st.source === 'agent' && <span class="chip-s faint">Claude</span>}</div>
                  </div>
                  <div class="mat-actions">
                    <button type="button" class="btn btn-line btn-sm" data-copy-text={text}>Kopiraj</button>
                    <a href={`/materials?tab=stories&edit=${st.id}`} class="btn btn-line btn-sm">Izmeni</a>
                    <form method="post" action={`/materials/stories/${st.id}/delete`} onsubmit="return confirm('Obrisati priču?')"><button class="btn btn-line btn-sm" type="submit">Obriši</button></form>
                  </div>
                </div>
                <div class="star">
                  {(['situation', 'task', 'action', 'result'] as const).map((k, i) => (
                    <div><div class="k">{'STAR'[i]} · {['Situacija', 'Zadatak', 'Akcija', 'Rezultat'][i]}</div><div class="v">{st[k] ?? <span class="faint">—</span>}</div></div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  if (tab === 'answers') {
    const like = `%${search}%`;
    const { results } = await c.env.DB
      .prepare(
        search
          ? 'SELECT * FROM answers WHERE question LIKE ?1 OR answer LIKE ?1 OR tags LIKE ?1 OR company LIKE ?1 ORDER BY updated_at DESC LIMIT 200'
          : 'SELECT * FROM answers ORDER BY updated_at DESC LIMIT 200',
      )
      .bind(...(search ? [like] : []))
      .all<AnswerRow>();
    const rows = results ?? [];
    const editing = edit ? rows.find((x) => x.id === edit) ?? (await c.env.DB.prepare('SELECT * FROM answers WHERE id = ?').bind(edit).first<AnswerRow>()) : null;
    body = (
      <>
        <div class="panel">
          <div class="panel-head">
            <h3>{editing ? 'Izmeni odgovor' : 'Novi odgovor'}</h3>
            {!editing && <AskClaude prompt={PROMPTS.answersImport()} label="Uvezi iz paketa za prijavu" />}
          </div>
          <form method="post" action={editing ? `/materials/answers/${editing.id}` : '/materials/answers'}>
            <div class="field"><label>Pitanje *</label><input name="question" required placeholder="npr. Tell us about a time you managed a complex calendar" value={editing?.question ?? ''} /></div>
            <div class="field"><label>Odgovor *</label><textarea name="answer" required rows={editing ? 10 : 5}>{editing?.answer ?? ''}</textarea></div>
            <div class="form-grid">
              <div class="field"><label>Tagovi (zarezom)</label><input name="tags" placeholder="motivacija, remote, plata" value={editing?.tags ?? ''} /></div>
              <div class="field"><label>Firma (opciono)</label><input name="company" value={editing?.company ?? ''} /></div>
            </div>
            <div class="form-actions">
              {editing && <a href="/materials?tab=answers" class="btn btn-line btn-sm">Otkaži</a>}
              <button type="submit" class="btn btn-solid btn-sm">Sačuvaj</button>
            </div>
          </form>
        </div>
        <form method="get" action="/materials" class="search-row">
          <input type="hidden" name="tab" value="answers" />
          <input name="q" value={search} placeholder="Traži po pitanju, odgovoru, tagu ili firmi…" />
          <button class="btn btn-line btn-sm" type="submit">Traži</button>
        </form>
        {rows.length === 0 && <div class="panel"><div class="faint">{search ? 'Ništa ne odgovara pretrazi.' : 'Biblioteka je prazna. Odgovori koje pišemo za forme se čuvaju ovde.'}</div></div>}
        <div class="stack">
          {rows.map((a) => (
            <details class="panel answer">
              <summary>
                <span class="q">{a.question}</span>
                <span class="faint mono" style="font-size:.7rem">{[a.company, ...tagList(a.tags)].filter(Boolean).join(' · ')}</span>
              </summary>
              <div class="prewrap" style="margin-top:10px">{a.answer}</div>
              <div class="mat-actions" style="margin-top:12px">
                <button type="button" class="btn btn-solid btn-sm" data-copy-text={a.answer}>Kopiraj odgovor</button>
                {a.job_id && <a href={`/jobs/${a.job_id}`} class="btn btn-line btn-sm">Oglas</a>}
                <a href={`/materials?tab=answers&edit=${a.id}`} class="btn btn-line btn-sm">Izmeni</a>
                <form method="post" action={`/materials/answers/${a.id}/delete`} onsubmit="return confirm('Obrisati odgovor?')"><button class="btn btn-line btn-sm" type="submit">Obriši</button></form>
              </div>
            </details>
          ))}
        </div>
      </>
    );
  }

  return c.html(
    <Layout title="Materijali" active="materials" user={user}>
      <Topbar crumb={<b>Materijali za prijave</b>} />
      <div class="content" style="max-width:1100px">
        {ok && OK[ok] && <Flash kind={ok === 'big' ? 'warn' : 'ok'}>{OK[ok]}</Flash>}
        <div class="page-head">
          <div>
            <h1>Materijali</h1>
            <div class="sub">CV verzije, STAR priče i odgovori koje si već dao. Agent ih koristi kad pravi pakete.</div>
          </div>
        </div>
        <nav class="tabs">
          {TABS.map(([k, l]) => <a href={k === 'cv' ? '/materials' : `/materials?tab=${k}`} class={tab === k ? 'active' : ''}>{l}</a>)}
        </nav>
        {body}
      </div>
    </Layout>,
  );
});

// ------------------------------------------------------------------ CV

async function saveCv(c: any, id: number | null) {
  const b = await c.req.parseBody();
  const name = s(b.name);
  if (!name) return c.redirect('/materials');
  const isDefault = b.is_default ? 1 : 0;
  const file = b.file instanceof File && b.file.size > 0 ? (b.file as File) : null;
  let tooBig = false;
  let data: ArrayBuffer | null = null;
  if (file) {
    if (file.size > MAX_FILE) tooBig = true;
    else data = await file.arrayBuffer();
  }
  const db: D1Database = c.env.DB;
  if (isDefault) await db.prepare('UPDATE cv_versions SET is_default = 0').run();
  if (id) {
    await db.prepare(`UPDATE cv_versions SET name=?, focus=?, content=?, is_default=?, updated_at=datetime('now') WHERE id=?`).bind(name, s(b.focus), s(b.content), isDefault, id).run();
    if (data) await db.prepare('UPDATE cv_versions SET file_name=?, file_type=?, file_data=? WHERE id=?').bind(file!.name, file!.type || 'application/pdf', data, id).run();
  } else {
    await db
      .prepare('INSERT INTO cv_versions (name, focus, content, file_name, file_type, file_data, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(name, s(b.focus), s(b.content), data ? file!.name : null, data ? file!.type || 'application/pdf' : null, data, isDefault)
      .run();
  }
  return c.redirect(`/materials?ok=${tooBig ? 'big' : 'cv'}`);
}

materialsRoutes.post('/materials/cv', (c) => saveCv(c, null));
materialsRoutes.post('/materials/cv/:id', (c) => saveCv(c, Number(c.req.param('id'))));
materialsRoutes.post('/materials/cv/:id/delete', async (c) => {
  await c.env.DB.prepare('DELETE FROM cv_versions WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.redirect('/materials?ok=cvdel');
});
materialsRoutes.get('/materials/cv/:id/file', async (c) => {
  const row = await c.env.DB.prepare('SELECT file_name, file_type, file_data FROM cv_versions WHERE id = ?').bind(Number(c.req.param('id'))).first<{ file_name: string; file_type: string; file_data: ArrayBuffer | number[] }>();
  if (!row?.file_data) return c.text('Nema fajla.', 404);
  const bytes = row.file_data instanceof ArrayBuffer ? new Uint8Array(row.file_data) : new Uint8Array(row.file_data as number[]);
  const name = (row.file_name || 'CV.pdf').replace(/[^\w.\- ]+/g, '_');
  return new Response(bytes, {
    headers: { 'content-type': row.file_type || 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'private, no-store' },
  });
});

// ------------------------------------------------------------------ stories

async function saveStory(c: any, id: number | null) {
  const b = await c.req.parseBody();
  const title = s(b.title);
  if (!title) return c.redirect('/materials?tab=stories');
  const vals = [title, s(b.tags), s(b.situation), s(b.task), s(b.action), s(b.result)];
  if (id) await c.env.DB.prepare(`UPDATE stories SET title=?, tags=?, situation=?, task=?, action=?, result=?, updated_at=datetime('now') WHERE id=?`).bind(...vals, id).run();
  else await c.env.DB.prepare('INSERT INTO stories (title, tags, situation, task, action, result) VALUES (?, ?, ?, ?, ?, ?)').bind(...vals).run();
  return c.redirect('/materials?tab=stories&ok=story');
}
materialsRoutes.post('/materials/stories', (c) => saveStory(c, null));
materialsRoutes.post('/materials/stories/:id', (c) => saveStory(c, Number(c.req.param('id'))));
materialsRoutes.post('/materials/stories/:id/delete', async (c) => {
  await c.env.DB.prepare('DELETE FROM stories WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.redirect('/materials?tab=stories&ok=storydel');
});

// ------------------------------------------------------------------ answers

async function saveAnswer(c: any, id: number | null) {
  const b = await c.req.parseBody();
  const q = s(b.question);
  const a = s(b.answer);
  if (!q || !a) return c.redirect('/materials?tab=answers');
  const back = s(b.back);
  if (id) await c.env.DB.prepare(`UPDATE answers SET question=?, answer=?, tags=?, company=?, updated_at=datetime('now') WHERE id=?`).bind(q, a, s(b.tags), s(b.company), id).run();
  else {
    const jobId = Number(b.job_id) || null;
    await c.env.DB.prepare('INSERT INTO answers (question, answer, tags, company, job_id) VALUES (?, ?, ?, ?, ?)').bind(q, a, s(b.tags), s(b.company), jobId).run();
  }
  return c.redirect(back && back.startsWith('/') ? back : '/materials?tab=answers&ok=ans');
}
materialsRoutes.post('/materials/answers', (c) => saveAnswer(c, null));
materialsRoutes.post('/materials/answers/:id', (c) => saveAnswer(c, Number(c.req.param('id'))));
materialsRoutes.post('/materials/answers/:id/delete', async (c) => {
  await c.env.DB.prepare('DELETE FROM answers WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.redirect('/materials?tab=answers&ok=ansdel');
});
