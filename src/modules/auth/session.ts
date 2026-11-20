import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, SessionUser } from '../../types';
import { randomToken } from '../../lib/password';

const COOKIE_NAME = 'js_session';
const SESSION_DAYS = 14;

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const id = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(id, userId, expiresAt).run();
  return id;
}

export async function destroySession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

export async function loadSessionUser(db: D1Database, sessionId: string): Promise<SessionUser | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.theme, u.leads_view
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`,
    )
    .bind(sessionId)
    .first<SessionUser>();
  return row ?? null;
}

export function setSessionCookie(c: Context, sessionId: string) {
  setCookie(c, COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

export function getSessionCookie(c: Context): string | undefined {
  return getCookie(c, COOKIE_NAME);
}
