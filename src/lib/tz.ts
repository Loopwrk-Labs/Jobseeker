// Belgrade wall-clock <-> UTC for <input type="datetime-local"> fields.
const TZ = 'Europe/Belgrade';

function offsetMinutes(utc: Date): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(utc)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUtc - utc.getTime()) / 60000);
}

/** "2026-12-02T15:00" (Belgrade) → "2026-12-02T14:00:00Z", or null. */
export function localToUtc(local: string): string | null {
  const m = String(local ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const guess = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  const off = offsetMinutes(guess);
  const d = new Date(guess.getTime() - off * 60000);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** "2026-12-02T14:00:00Z" → "2026-12-02T15:00" (Belgrade). */
export function utcToLocal(utc: string | null | undefined): string {
  if (!utc) return '';
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return '';
  const l = new Date(d.getTime() + offsetMinutes(d) * 60000);
  return l.toISOString().slice(0, 16);
}

/** "sre 02.12. 15:00" */
export function fmtWhen(utc: string): string {
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return utc;
  const f = new Intl.DateTimeFormat('sr-Latn-RS', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  return f.format(d).replace(/\s+/g, ' ');
}
