import { Hono } from 'hono';
import type { Env, SessionUser } from './types';
import { loadUser } from './modules/auth/middleware';
import { authRoutes } from './modules/auth/routes';
import { dashboardRoutes } from './modules/dashboard';
import { jobRoutes } from './modules/jobs/routes';
import { excludedRoutes } from './modules/excluded/routes';
import { agentRoutes } from './modules/agent/routes';
import { profileRoutes } from './modules/profile/routes';
import { settingsRoutes } from './modules/settings/routes';
import { calculatorRoutes } from './modules/calculator/routes';
import { refreshRates } from './modules/fx/service';

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser | null } }>();

app.use('*', loadUser);

// One central auth gate (same reasoning as Loopforce: sub-app `.use('*')`
// middleware leaks into the global chain once mounted). There is no public
// API: the agent writes to D1 directly through the Cloudflare connector.
const PUBLIC_PATHS = new Set(['/login', '/setup']);
app.use('*', async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) return next();
  if (!c.get('user')) return c.redirect('/login');
  return next();
});

app.route('/', authRoutes);
app.route('/', dashboardRoutes);
app.route('/', jobRoutes);
app.route('/', excludedRoutes);
app.route('/', agentRoutes);
app.route('/', profileRoutes);
app.route('/', settingsRoutes);
app.route('/', calculatorRoutes);

app.notFound((c) => c.text('Nema te stranice.', 404));

export default {
  fetch: app.fetch,
  // Daily NBS exchange-rate refresh (Workers Free includes cron triggers).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshRates(env.DB));
  },
} satisfies ExportedHandler<Env>;
