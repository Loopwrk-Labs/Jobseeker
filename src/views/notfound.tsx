import type { Context } from 'hono';
import type { SessionUser } from '../types';
import { Layout } from './layout';

/** A 404 inside the app shell, so the menu is still there to get back. */
export function notFoundPage(c: Context, msg = 'Ova stranica ne postoji.', back = '/', backLabel = 'Na početnu') {
  const user = c.get('user') as SessionUser | null;
  if (!user) return c.text(msg, 404);
  return c.html(
    <Layout title="Nema" active="" user={user}>
      <div class="panel" style="max-width:520px;margin:40px auto;text-align:center">
        <h2 style="margin:0 0 8px">404</h2>
        <p class="dim" style="margin:0 0 16px">{msg}</p>
        <a class="btn" href={back}>{backLabel}</a>
      </div>
    </Layout>,
    404,
  );
}
