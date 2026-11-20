// Shared formatting helpers: Serbian date format, money, dash cleanup.

const TZ = 'Europe/Belgrade';

/** D1 stores `datetime('now')` as "YYYY-MM-DD HH:MM:SS" (UTC) and plain dates as "YYYY-MM-DD". */
function parse(value: string): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T12:00:00Z'); // date only, no TZ shift
  const iso = value.includes('T') ? value : value.replace(' ', 'T');
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

function parts(d: Date, withTime: boolean) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** 04.10.2026. */
export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}.${m}.${y}.`;
  }
  const d = parse(value);
  if (!d) return value;
  const p = parts(d, false);
  return `${p.day}.${p.month}.${p.year}.`;
}

/** 04.10.2026. 14:30 (24h, Belgrade time) */
export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = parse(value);
  if (!d) return value;
  const p = parts(d, true);
  return `${p.day}.${p.month}.${p.year}. ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** Accepts "04.10.2026.", "4.10.2026", "04/10/2026" or "2026-10-04"; returns "2026-10-04" or null. */
export function parseDateInput(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})\.?$/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Today in Belgrade as YYYY-MM-DD. */
export function todayISO(): string {
  const p = parts(new Date(), false);
  return `${p.year}-${p.month}-${p.day}`;
}

/** YYYY-MM-DD plus n days (calendar arithmetic, no time zone involved). */
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Offset (ms) of Belgrade from UTC at the given instant. */
function belgradeOffsetMs(at: Date): number {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(at)) o[p.type] = p.value;
  const asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour === 24 ? 0 : +o.hour, +o.minute, +o.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The start of the given Belgrade day (default: today) as a UTC "YYYY-MM-DD HH:MM:SS" string, comparable with D1 timestamps. */
export function belgradeDayStartUtc(day: string = todayISO()): string {
  const [y, m, d] = day.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d);
  const guess = midnightUtc - belgradeOffsetMs(new Date(midnightUtc));
  const start = new Date(midnightUtc - belgradeOffsetMs(new Date(guess)));
  return start.toISOString().slice(0, 19).replace('T', ' ');
}

/** Belgrade calendar day (YYYY-MM-DD) of a D1 UTC timestamp. */
export function belgradeDayOf(value: string): string {
  const d = parse(value);
  if (!d) return '';
  const p = parts(d, false);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 12.500,00 EUR (Serbian number format). */
export function fmtMoney(amount: number | null | undefined, currency = 'EUR'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  const n = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  return `${n} ${currency}`;
}

/**
 * Removes long dashes (— and –) from text people will send or read as prose.
 * Spaced dashes become a comma, a dash between digits (a range) becomes a hyphen.
 */
export function stripDashes(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return text ?? null;
  return text
    .replace(/(\d[kKmM]?)\s*[–—]\s*(\$?€?\d)/g, '$1-$2') // ranges: 12–18k, $12k–$18k
    .replace(/(\S)–(\S)/g, '$1-$2') // unspaced en dash between words: a hyphen
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*/gm, '')
    .replace(/,\s*([.!?])/g, '$1');
}
