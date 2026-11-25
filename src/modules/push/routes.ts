import { Hono } from 'hono';
import type { Env, SessionUser } from '../../types';
import { getVapid, sendPush, putSetting } from './service';

type Vars = { user: SessionUser | null };
export const pushRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

pushRoutes.get('/push/key', async (c) => c.json({ publicKey: (await getVapid(c.env.DB)).publicKey }));

pushRoutes.post('/push/subscribe', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string }; label?: string } | null;
  if (!b?.endpoint || !b.keys?.p256dh || !b.keys?.auth || !/^https:\/\//.test(b.endpoint)) return c.json({ ok: false }, 400);
  await c.env.DB.prepare(
    'INSERT INTO push_subscriptions (endpoint, p256dh, auth, label) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label',
  ).bind(b.endpoint, b.keys.p256dh, b.keys.auth, (b.label ?? '').slice(0, 80) || null).run();
  await putSetting(c.env.DB, 'app_origin', new URL(c.req.url).origin);
  return c.json({ ok: true });
});

pushRoutes.post('/push/unsubscribe', async (c) => {
  const b = (await c.req.json().catch(() => null)) as { endpoint?: string } | null;
  if (b?.endpoint) await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(b.endpoint).run();
  return c.json({ ok: true });
});

pushRoutes.post('/push/test', async (c) => {
  const r = await sendPush(c.env.DB, { title: 'Jobseeker', body: 'Notifikacije rade. Javljam za intervjue, odgovore i nove oglase.', url: '/', tag: 'test' });
  return c.json(r);
});
