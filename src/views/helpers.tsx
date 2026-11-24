import type { JobStatus, JobLevel } from '../types';
import { STATUS_LABEL, STATUS_DESC, STATUS_COLOR, LEVEL_LABEL } from '../types';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span class="pill" style={`--pc:${STATUS_COLOR[status]}`} data-tooltip={STATUS_DESC[status]}>
      <span class="d"></span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function LevelTag({ level }: { level: JobLevel }) {
  return <span class={`lvl lvl-${level}`}>{LEVEL_LABEL[level]}</span>;
}

export function FitBadge({ fit }: { fit: number | null }) {
  if (fit == null) return <span class="faint">—</span>;
  const tone = fit >= 7 ? 'hi' : fit >= 5 ? 'mid' : 'lo';
  return <span class={`fit fit-${tone}`}>{fit}/10</span>;
}

export function Flash({ kind = 'ok', children }: { kind?: 'ok' | 'err' | 'warn'; children?: any }) {
  return (
    <div class={`flash ${kind}`} data-autodismiss={kind === 'ok' ? '' : undefined}>
      <span>{children}</span>
      {kind === 'ok' && (
        <button type="button" class="flash-x" aria-label="Zatvori">
          ×
        </button>
      )}
    </div>
  );
}

/** Only http(s) links are rendered as links (data from the agent is untrusted). */
export function safeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.toString() : null;
  } catch {
    return null;
  }
}

export function hostOf(u: string | null | undefined): string {
  const s = safeUrl(u);
  if (!s) return '';
  return new URL(s).hostname.replace(/^www\./, '');
}

export { fmtDate, fmtDateTime, todayISO } from '../lib/format';

// ------------------------------------------------------------------ salary from the posting

const PERIOD_SHORT: Record<string, string> = { month: 'mes.', year: 'god.', hour: 'h' };
const CUR_SIGN: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

function money(n: number): string {
  return new Intl.NumberFormat('sr-RS', { maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);
}

/** "$3.500–4.000 / mes. bruto", or null when the posting gave no number. */
export function salaryText(j: {
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  salary_kind: string | null;
}): string | null {
  const lo = j.salary_min ?? j.salary_max;
  const hi = j.salary_max ?? j.salary_min;
  if (lo == null || hi == null) return null;
  const cur = j.salary_currency ?? 'EUR';
  const sign = CUR_SIGN[cur];
  const range = lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
  const amount = sign ? `${sign}${range}` : `${range} ${cur}`;
  const per = PERIOD_SHORT[j.salary_period ?? 'month'] ?? 'mes.';
  const kind = j.salary_kind === 'net' ? ' neto' : j.salary_kind === 'gross' ? ' bruto' : '';
  return `${amount} / ${per}${kind}`;
}

/** Employer's offered salary: always bold red, so Alex can pitch above it. */
export function SalaryTag({ job }: { job: Parameters<typeof salaryText>[0] }) {
  const t = salaryText(job);
  return t ? <span class="salary-offer" data-tooltip="Plata iz oglasa">{t}</span> : null;
}

/** Risks text with lines about pay ("Plata:", "Satnica…", "Salary") in bold red. */
export function RisksText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((ln, i) => {
        const pay = /^\s*(?:[-•*]\s*)?(plata|satnica|salary|rate|budžet|budget)\b/i.test(ln) && !/nije navedena|not stated|nije naveden/i.test(ln);
        return (
          <>
            {pay ? <span class="salary-offer">{ln}</span> : ln}
            {i < lines.length - 1 ? '\n' : ''}
          </>
        );
      })}
    </>
  );
}
