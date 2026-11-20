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
