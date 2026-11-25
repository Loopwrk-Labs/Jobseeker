import { Hono } from 'hono';
import type { Env, SessionUser } from '../../types';
import { connect, disconnect, getConfig, verify, ingest, fetchContent } from './service';
import { sendPush } from '../push/service';

type Vars = { user: SessionUser | null };
export const fathomRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const s = (v: unknown) => {
  const t = String(v ?? '').trim();
  return t ? t : null;
};
const back = (v: unknown, fallback: string) => {
  const b = s(v);
  return b && b.startsWith('/') ? b : fallback;
};

/** Public endpoint: Fathom calls it when a recording is ready. Signature-checked. */
fathomRoutes.post('/fathom/webhook', async (c) => {
  const cfg = await getConfig(c.env.DB);
  const body = await c.req.text();
  if (!cfg || !(await verify(cfg.secret, c.req.raw.headers, body))) return c.text('invalid signature', 401);
  let m: any;
  try {
    m = JSON.parse(body);
  } catch {
    return c.text('bad json', 400);
  }
  if (!m?.recording_id) return c.text('ok');
  const { interviewId } = await ingest(c.env.DB, m);
  if (interviewId) {
    const iv = await c.env.DB.prepare('SELECT i.job_id, j.company FROM interviews i LEFT JOIN jobs j ON j.id = i.job_id WHERE i.id = ?').bind(interviewId).first<{ job_id: number | null; company: string | null }>();
    c.executionCtx.waitUntil(
      sendPush(c.env.DB, {
        title: `🎙 Snimak intervjua stigao${iv?.company ? `: ${iv.company}` : ''}`,
        body: 'Transkript i rezime su u Jobseeker-u. Oceni intervju dok ti je sveže.',
        url: iv?.job_id ? `/jobs/${iv.job_id}?tab=intervjui#fb-${interviewId}` : '/calendar',
        tag: `rec-${interviewId}`,
      }).then(() => undefined),
    );
  }
  return c.text('ok');
});

fathomRoutes.post('/fathom/connect', async (c) => {
  const b = await c.req.parseBody();
  const key = s(b.api_key);
  if (!key) return c.redirect('/calendar?fathom=missing#fathom');
  const r = await connect(c.env.DB, key, new URL(c.req.url).origin);
  return c.redirect(r.ok ? '/calendar?fathom=ok#fathom' : `/calendar?fathom=err&msg=${encodeURIComponent(r.error)}#fathom`);
});

fathomRoutes.post('/fathom/disconnect', async (c) => {
  await disconnect(c.env.DB);
  return c.redirect('/calendar?fathom=off#fathom');
});

fathomRoutes.post('/recordings/:id/link', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const iv = Number(b.interview_id) || null;
  await c.env.DB.prepare('UPDATE recordings SET interview_id = ? WHERE id = ?').bind(iv, id).run();
  if (iv) await fetchContent(c.env.DB, id);
  return c.redirect(back(b.back, '/calendar#fathom'));
});

fathomRoutes.post('/recordings/:id/delete', async (c) => {
  const b = await c.req.parseBody();
  await c.env.DB.prepare('DELETE FROM recordings WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.redirect(back(b.back, '/calendar#fathom'));
});

// ------------------------------------------------------------------ feedback

const rate = (v: unknown) => {
  const n = Number(v);
  return n >= 1 && n <= 5 ? Math.round(n) : null;
};

fathomRoutes.post('/interviews/:id/feedback', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.parseBody();
  const ww = ['yes', 'maybe', 'no'].includes(String(b.would_work)) ? String(b.would_work) : null;
  await c.env.DB.prepare(
    `INSERT INTO interview_feedback (interview_id, feeling, feeling_text, r_respect, r_prep, r_clarity, r_time, r_comms, red_flags, would_work, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(interview_id) DO UPDATE SET feeling=excluded.feeling, feeling_text=excluded.feeling_text, r_respect=excluded.r_respect,
       r_prep=excluded.r_prep, r_clarity=excluded.r_clarity, r_time=excluded.r_time, r_comms=excluded.r_comms,
       red_flags=excluded.red_flags, would_work=excluded.would_work, notes=excluded.notes, updated_at=datetime('now')`,
  ).bind(id, rate(b.feeling), s(b.feeling_text), rate(b.r_respect), rate(b.r_prep), rate(b.r_clarity), rate(b.r_time), rate(b.r_comms), s(b.red_flags), ww, s(b.notes)).run();
  const target = back(b.back, '/calendar');
  return c.redirect(`${target}${target.includes('?') ? '&' : '?'}ok=fb#fb-${id}`);
});
