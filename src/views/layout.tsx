import type { FC } from 'hono/jsx';
import type { SessionUser } from '../types';
import { BrandLogo } from './logo';
import { initials } from './helpers';

const NAV_ITEMS = [
  { href: '/', key: 'dashboard', label: 'Pregled' },
  { href: '/jobs', key: 'jobs', label: 'Poslovi' },
  { href: '/excluded', key: 'excluded', label: 'Izbačeni' },
  { href: '/agent', key: 'agent', label: 'Agent' },
  { href: '/profile', key: 'profile', label: 'Profil i kriterijumi' },
] as const;

function NavIcon({ name }: { name: string }) {
  switch (name) {
    case 'dashboard':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <rect x="3" y="3" width="7" height="9" rx="1"></rect>
          <rect x="14" y="3" width="7" height="5" rx="1"></rect>
          <rect x="14" y="12" width="7" height="9" rx="1"></rect>
          <rect x="3" y="16" width="7" height="5" rx="1"></rect>
        </svg>
      );
    case 'jobs':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <rect x="3" y="7" width="18" height="13" rx="2"></rect>
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"></path>
        </svg>
      );
    case 'excluded':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M5.6 5.6l12.8 12.8"></path>
        </svg>
      );
    case 'agent':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
          <rect x="5" y="8" width="14" height="11" rx="2"></rect>
          <path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"></path>
        </svg>
      );
    case 'profile':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <circle cx="12" cy="8" r="3.5"></circle>
          <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"></path>
        </svg>
      );
    default:
      return null;
  }
}

export const Head: FC<{ title: string }> = ({ title }) => (
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>{title} · Jobseeker</title>
    <meta name="theme-color" content="#070708" />
    <meta name="robots" content="noindex, nofollow" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/icon-180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Jobseeker" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
    />
    <link rel="stylesheet" href="/style.css" />
    <link rel="stylesheet" href="/jobseeker.css" />
    <script src="/dropdowns.js" defer></script>
    <script src="/ui.js" defer></script>
  </head>
);

export const Layout: FC<{ title: string; active: string; user: SessionUser; children?: any }> = ({ title, active, user, children }) => (
  <html lang="sr" data-theme={user.theme === 'light' || user.theme === 'dark' ? user.theme : undefined}>
    <Head title={title} />
    <body>
      <a href="#main" class="skip-link">
        Preskoči na sadržaj
      </a>
      <div class="app">
        <div class="nav-scrim" onclick="document.body.classList.remove('nav-open')"></div>
        <aside class="sidebar">
          <a href="/" class="wordmark" aria-label="Jobseeker početna">
            <BrandLogo size="side" />
          </a>
          <nav class="nav" aria-label="Glavni meni">
            {NAV_ITEMS.map((item) => (
              <a href={item.href} class={active === item.key ? 'active' : ''}>
                <NavIcon name={item.key} />
                {item.label}
              </a>
            ))}
          </nav>
          <form method="post" action="/me/theme" class="theme-sw" aria-label="Tema">
            {(['auto', 'light', 'dark'] as const).map((t) => (
              <button type="submit" name="theme" value={t} class={user.theme === t ? 'on' : ''} aria-pressed={user.theme === t ? 'true' : 'false'}>
                {t === 'auto' ? 'Auto' : t === 'light' ? 'Svetla' : 'Tamna'}
              </button>
            ))}
          </form>
          <button type="button" class="kbd-hint" data-kbd-help>
            Prečice · pritisni ?
          </button>
          <div class="sidebar-foot">
            <span class="avatar">{initials(user.name)}</span>
            <div>
              <div class="who">{user.name}</div>
              <div class="role">vlasnik</div>
            </div>
            <form method="post" action="/logout">
              <button class="linklike" type="submit">
                Odjava
              </button>
            </form>
          </div>
        </aside>
        <main class="main" id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </body>
  </html>
);

export const Topbar: FC<{ crumb?: any; right?: any; q?: string }> = ({ crumb, right, q }) => (
  <div class="topbar">
    <button type="button" class="menu-btn" aria-label="Meni" onclick="document.body.classList.toggle('nav-open')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M4 7h16M4 12h16M4 17h16"></path>
      </svg>
    </button>
    {crumb ? (
      <div class="crumb">{crumb}</div>
    ) : (
      <form class="search" method="get" action="/jobs">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="M20 20l-3.5-3.5"></path>
        </svg>
        <input type="search" name="q" value={q ?? ''} placeholder="Traži firmu ili poziciju…" />
      </form>
    )}
    <div class="spacer"></div>
    {right}
  </div>
);
