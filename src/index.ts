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
import { materialsRoutes } from './modules/materials/routes';
import { calendarRoutes } from './modules/calendar/routes';
import { contactRoutes } from './modules/contacts/routes';
import { statsRoutes } from './modules/stats/routes';
import { pushRoutes } from './modules/push/routes';
import { runNotifications } from './modules/push/service';
import { fathomRoutes } from './modules/fathom/routes';
import { notFoundPage } from './views/notfound';

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser | null } }>();

app.use('*', loadUser);

// One central auth gate (same reasoning as Loopforce: sub-app `.use('*')`
// middleware leaks into the global chain once mounted). There is no public
// API: the agent writes to D1 directly through the Cloudflare connector.
// /calendar.ics is protected by its own secret token (Google Calendar fetches it);
// /fathom/webhook by Fathom's HMAC signature.
const PUBLIC_PATHS = new Set(['/login', '/setup', '/calendar.ics', '/fathom/webhook']);
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
app.route('/', materialsRoutes);
app.route('/', calendarRoutes);
app.route('/', contactRoutes);
app.route('/', statsRoutes);
app.route('/', pushRoutes);
app.route('/', fathomRoutes);

app.notFound((c) => notFoundPage(c));

export default {
  fetch: app.fetch,
  // Every 15 min: push notifications (status changes, interview reminders,
  // morning digest) and the daily NBS rate refresh.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNotifications(env.DB));
  },
} satisfies ExportedHandler<Env>;
