// Official NBS middle exchange rates (srednji kurs), refreshed once a day.
// Source: kurs.resenje.org, a free public API that republishes the National
// Bank of Serbia rate list. Stored in app_settings('fx_rates') so pages never
// wait on the network; a cron refreshes it and a stale read retries lazily.

export type FxCode = 'EUR' | 'USD' | 'GBP';
export const FX_CODES: FxCode[] = ['EUR', 'USD', 'GBP'];

export interface FxRates {
  date: string | null; // NBS rate list date (YYYY-MM-DD)
  fetched_at: string; // ISO timestamp of the last successful fetch
  rates: Record<FxCode, number>; // RSD for 1 unit
}

// Used only until the first successful fetch.
export const FX_FALLBACK: FxRates = { date: null, fetched_at: '', rates: { EUR: 117.2, USD: 101, GBP: 134 } };

const KEY = 'fx_rates';
const ATTEMPT_KEY = 'fx_rates_attempt';

function belgradeToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date());
}

async function fetchOne(code: FxCode): Promise<{ middle: number; date: string }> {
  const res = await fetch(`https://kurs.resenje.org/api/v1/currencies/${code.toLowerCase()}/rates/today`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`${code}: HTTP ${res.status}`);
  const j = (await res.json()) as { exchange_middle?: number; number?: number; date?: string };
  const middle = Number(j.exchange_middle) / (Number(j.number) || 1);
  if (!isFinite(middle) || middle <= 0) throw new Error(`${code}: bad rate`);
  return { middle, date: String(j.date ?? '') };
}

export async function refreshRates(db: D1Database): Promise<FxRates | null> {
  await db
    .prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(ATTEMPT_KEY, new Date().toISOString())
    .run();
  try {
    const got = await Promise.all(FX_CODES.map(fetchOne));
    const fx: FxRates = {
      date: got[0].date || belgradeToday(),
      fetched_at: new Date().toISOString(),
      rates: { EUR: got[0].middle, USD: got[1].middle, GBP: got[2].middle },
    };
    await db
      .prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(KEY, JSON.stringify(fx))
      .run();
    return fx;
  } catch (e) {
    console.error('NBS rates refresh failed', e);
    return null;
  }
}

// Stored rates; if they are not from today's Belgrade date (and we have not
// tried in the last hour), try one refresh before answering.
export async function getRates(db: D1Database): Promise<FxRates> {
  const rows = await db
    .prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?)')
    .bind(KEY, ATTEMPT_KEY)
    .all<{ key: string; value: string }>();
  const map = Object.fromEntries((rows.results ?? []).map((r) => [r.key, r.value]));
  let fx: FxRates | null = null;
  try {
    fx = map[KEY] ? (JSON.parse(map[KEY]) as FxRates) : null;
  } catch {
    fx = null;
  }
  const fetchedDay = fx?.fetched_at
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade' }).format(new Date(fx.fetched_at))
    : null;
  const lastAttempt = map[ATTEMPT_KEY] ? Date.parse(map[ATTEMPT_KEY]) : 0;
  if (fetchedDay !== belgradeToday() && Date.now() - lastAttempt > 60 * 60 * 1000) {
    fx = (await refreshRates(db)) ?? fx;
  }
  return fx ?? FX_FALLBACK;
}
