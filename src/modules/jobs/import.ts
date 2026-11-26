// "Uvezi iz linka": read a job posting page and prefill the job form.
// Uses schema.org JobPosting JSON-LD when the page has it (most ATSs, Djinni,
// LinkedIn public pages), otherwise Open Graph / <title>.
import type { JobRow } from '../../types';

export interface Imported {
  job: Partial<JobRow>;
  posted: string | null;
  note: string | null; // what could not be read
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const strip = (html: string) => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const meta = (html: string, prop: string) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
  return m ? decode(m[1]).trim() : null;
};

function findPosting(node: any): any {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) { const r = findPosting(n); if (r) return r; }
    return null;
  }
  const t = node['@type'];
  if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return node;
  return findPosting(node['@graph']) ?? null;
}

const PERIOD: Record<string, string> = { MONTH: 'month', YEAR: 'year', HOUR: 'hour' };

export async function importFromUrl(url: string): Promise<Imported> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Stranica je vratila ${res.status}.`);
  const html = (await res.text()).slice(0, 3_000_000);

  let posting: any = null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      posting = findPosting(JSON.parse(m[1].trim()));
    } catch { /* malformed JSON-LD */ }
    if (posting) break;
  }

  const job: Partial<JobRow> = { url: res.url || url };
  let posted: string | null = null;
  if (posting) {
    job.title = decode(String(posting.title ?? '')).trim() || undefined;
    const org = posting.hiringOrganization;
    job.company = (typeof org === 'string' ? org : org?.name) ? decode(String(typeof org === 'string' ? org : org.name)).trim() : undefined;
    const remote = String(posting.jobLocationType ?? '').toUpperCase().includes('TELECOMMUTE');
    const req = [].concat(posting.applicantLocationRequirements ?? []).map((r: any) => r?.name).filter(Boolean).join(', ');
    const loc = [].concat(posting.jobLocation ?? []).map((l: any) => [l?.address?.addressLocality, l?.address?.addressCountry?.name ?? l?.address?.addressCountry].filter(Boolean).join(', ')).filter(Boolean).join(' / ');
    job.location = [remote ? 'Remote' : null, req || null, !remote ? loc || null : null].filter(Boolean).join(' · ') || undefined;
    const et = [].concat(posting.employmentType ?? []).join(', ');
    if (et) job.contract_type = et.replace(/_/g, '-').toLowerCase().replace(/^./, (c) => c.toUpperCase());
    const bs = posting.baseSalary;
    const v = bs?.value;
    const min = Number(v?.minValue ?? v?.value ?? (typeof v === 'number' ? v : NaN));
    const max = Number(v?.maxValue ?? v?.value ?? (typeof v === 'number' ? v : NaN));
    if (isFinite(min) || isFinite(max)) {
      job.salary_min = isFinite(min) && min > 0 ? min : null;
      job.salary_max = isFinite(max) && max > 0 ? max : null;
      job.salary_currency = ['EUR', 'USD', 'GBP', 'RSD'].includes(String(bs?.currency)) ? String(bs.currency) : 'EUR';
      job.salary_period = PERIOD[String(v?.unitText ?? '').toUpperCase()] ?? 'month';
      job.salary_kind = 'gross';
    }
    posted = posting.datePosted ? String(posting.datePosted).slice(0, 10) : null;
    if (posting.description) {
      const d = strip(String(posting.description));
      job.notes = `Iz oglasa:\n${d.length > 1800 ? `${d.slice(0, 1800)}…` : d}`;
    }
  }
  if (!job.title || !job.company) {
    const og = meta(html, 'og:title') ?? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').trim();
    const site = meta(html, 'og:site_name');
    // Prefer the strongest separator: "Title | Company", then "Title at Company", then "Title - Company".
    const split = (re: RegExp) => og.split(re).map((x) => x.trim()).filter(Boolean);
    const parts = [split(/\s+\|\s+/), split(/\s+at\s+/i), split(/\s+[-–—]\s+/)].find((p) => p.length > 1) ?? [og];
    if (!job.title && parts[0]) job.title = parts[0];
    if (!job.company && parts.length > 1) job.company = parts.find((p, i) => i > 0 && p !== site && !/djinni|linkedin|indeed|glassdoor|jobs?$/i.test(p)) ?? undefined;
    if (!job.notes) {
      const d = meta(html, 'og:description') ?? meta(html, 'description');
      if (d) job.notes = d;
    }
  }
  const missing = [!job.title && 'pozicija', !job.company && 'firma'].filter(Boolean);
  return { job, posted, note: missing.length ? `Nisam uspeo da pročitam: ${missing.join(', ')}. Popuni ručno.` : null };
}
