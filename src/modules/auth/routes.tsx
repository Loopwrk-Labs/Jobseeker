import { Hono } from 'hono';
import type { Env, SessionUser } from '../../types';
import { BrandLogo } from '../../views/logo';
import { hashPassword, verifyPassword } from '../../lib/password';
import { createSession, destroySession, setSessionCookie, clearSessionCookie, getSessionCookie } from './session';

type Vars = { user: SessionUser | null };
export const authRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

authRoutes.get('/login', async (c) => {
  const user = c.get('user');
  if (user) return c.redirect('/');

  // First-run: no users yet → send to setup instead of a login that can never work.
  const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM users').first<{ n: number }>();
  if (!count || count.n === 0) return c.redirect('/setup');

  const error = c.req.query('error');
  return c.html(
    <html lang="sr">
      <head>
        <meta charset="utf-8" />
        <title>Jobseeker · Prijava</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-180.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <div class="login-wrap">
          <div class="blob b1"></div>
          <div class="blob b2"></div>
          <div class="card">
            <div class="corner tl"></div>
            <div class="corner tr"></div>
            <div class="corner bl"></div>
            <div class="corner br"></div>
            <div class="wordmark-lg">
              <BrandLogo size="lg" />
            </div>
            <div class="lede mono">Lični tracker za traženje posla</div>
            {error && <div class="error-box">{error === 'locked' ? 'Previše pokušaja, probaj ponovo kasnije.' : 'Pogrešan email ili lozinka.'}</div>}
            <form method="post" action="/login">
              <div class="field">
                <label>Email</label>
                <input type="email" name="email" required autofocus />
              </div>
              <div class="field">
                <label>Lozinka</label>
                <input type="password" name="password" required />
              </div>
              <button class="btn btn-solid" style="width:100%;justify-content:center" type="submit">
                Prijavi se
              </button>
            </form>
            <div class="footnote">
              Nema javne registracije. Nalog postoji samo za vlasnika.
            </div>
          </div>
        </div>
      </body>
    </html>,
  );
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<{
    id: number;
    email: string;
    name: string;
    password_hash: string;
    role: string;
    failed_attempts: number;
    locked_until: string | null;
  }>();

  if (!user) return c.redirect('/login?error=invalid');

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return c.redirect('/login?error=locked');
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const attempts = (user.failed_attempts ?? 0) + 1;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString();
      await c.env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?')
        .bind(lockedUntil, user.id)
        .run();
      return c.redirect('/login?error=locked');
    }
    await c.env.DB.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').bind(attempts, user.id).run();
    return c.redirect('/login?error=invalid');
  }

  await c.env.DB.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').bind(user.id).run();
  const sessionId = await createSession(c.env.DB, user.id);
  setSessionCookie(c, sessionId);
  return c.redirect('/');
});

authRoutes.post('/logout', async (c) => {
  const sessionId = getSessionCookie(c);
  if (sessionId) await destroySession(c.env.DB, sessionId);
  clearSessionCookie(c);
  return c.redirect('/login');
});

// First-run setup: only reachable while the users table is empty.
authRoutes.get('/setup', async (c) => {
  const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM users').first<{ n: number }>();
  if (count && count.n > 0) return c.redirect('/login');

  return c.html(
    <html lang="sr">
      <head>
        <meta charset="utf-8" />
        <title>Jobseeker · Podešavanje</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icon-180.png" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <div class="login-wrap">
          <div class="blob b1"></div>
          <div class="blob b2"></div>
          <div class="card" style="width:420px">
            <div class="corner tl"></div>
            <div class="corner tr"></div>
            <div class="corner bl"></div>
            <div class="corner br"></div>
            <div class="wordmark-lg">
              <BrandLogo size="lg" />
            </div>
            <div class="lede mono">Prvo pokretanje: napravi svoj nalog</div>
            <form method="post" action="/setup">
              <div class="field">
                <label>Ime</label>
                <input type="text" name="name" required autofocus />
              </div>
              <div class="field">
                <label>Email</label>
                <input type="email" name="email" required />
              </div>
              <div class="field">
                <label>Lozinka</label>
                <input type="password" name="password" minLength={10} required />
              </div>
              <button class="btn btn-solid" style="width:100%;justify-content:center" type="submit">
                Napravi nalog i nastavi
              </button>
            </form>
            <div class="footnote">Ovaj ekran nestaje čim se napravi prvi nalog.</div>
          </div>
        </div>
      </body>
    </html>,
  );
});

authRoutes.post('/setup', async (c) => {
  const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM users').first<{ n: number }>();
  if (count && count.n > 0) return c.redirect('/login');

  const body = await c.req.parseBody();
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!name || !email || password.length < 10) {
    return c.text('Potrebni su ime, email i lozinka od najmanje 10 karaktera.', 400);
  }

  const hash = await hashPassword(password);
  const result = await c.env.DB.prepare(
    'INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)',
  )
    .bind(email, name, hash, 'admin')
    .run();

  const userId = result.meta.last_row_id as number;
  const sessionId = await createSession(c.env.DB, userId);
  setSessionCookie(c, sessionId);
  return c.redirect('/');
});
