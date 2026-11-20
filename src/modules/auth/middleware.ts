import type { MiddlewareHandler } from 'hono';
import type { Env, SessionUser } from '../../types';
import { getSessionCookie, loadSessionUser } from './session';

// Attaches `user` (SessionUser | null) to context for every request.
// The actual auth GATE (redirect-to-login, admin-only) lives centrally in
// src/index.ts — see the comment there for why a per-module `.use('*', ...)`
// middleware doesn't stay scoped to that module once mounted.
export const loadUser: MiddlewareHandler<{ Bindings: Env; Variables: { user: SessionUser | null } }> = async (
  c,
  next,
) => {
  const sessionId = getSessionCookie(c);
  if (!sessionId) {
    c.set('user', null);
    return next();
  }
  const user = await loadSessionUser(c.env.DB, sessionId);
  c.set('user', user);
  if (user) {
    // Last visit: at most one write per user per 5 minutes (keeps D1 writes low).
    // Fire-and-forget so it never slows the page down or breaks it.
    const touch = c.env.DB.prepare(
      "UPDATE users SET last_seen_at = datetime('now') WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-5 minutes'))",
    )
      .bind(user.id)
      .run()
      .catch(() => {});
    try {
      c.executionCtx.waitUntil(touch);
    } catch {
      /* no execution context (e.g. tests) — the promise still runs */
    }
  }
  return next();
};
