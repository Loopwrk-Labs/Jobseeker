import { Hono } from 'hono';
import type { Env, SessionUser, Theme } from '../../types';

type Vars = { user: SessionUser | null };
export const settingsRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

settingsRoutes.post('/me/theme', async (c) => {
  const user = c.get('user') as SessionUser;
  const body = await c.req.parseBody();
  const theme = String(body.theme ?? 'auto') as Theme;
  if (['auto', 'light', 'dark'].includes(theme)) {
    await c.env.DB.prepare('UPDATE users SET theme = ? WHERE id = ?').bind(theme, user.id).run();
  }
  let target = '/';
  try {
    const ref = new URL(c.req.header('Referer') ?? '');
    if (ref.host === new URL(c.req.url).host) target = ref.pathname + ref.search + ref.hash;
  } catch { /* missing or malformed Referer */ }
  return c.redirect(target);
});
