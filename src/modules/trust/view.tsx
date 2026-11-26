import { raw } from 'hono/html';
import type { JobRow } from '../../types';
import { renderMarkdown } from '../../lib/markdown';
import { fmtDate } from '../../lib/format';
import { AskClaude, PROMPTS } from '../../lib/claude';
import { TRUST_LABEL, SCAM_CHECKLIST, type Signal, type Trust } from './signals';

const ICON: Record<Trust | 'none', string> = {
  ok: '<path d="M20 6 9 17l-5-5"/>',
  caution: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  scam: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
  none: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
};

export function TrustBadge({ trust, compact = false }: { trust: JobRow['trust']; compact?: boolean }) {
  const t = trust ?? 'none';
  if (compact && t === 'none') return null;
  return (
    <span class={`trust trust-${t}${compact ? ' compact' : ''}`} title={TRUST_LABEL[t]}>
      {raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t]}</svg>`)}
      {(!compact || t !== 'ok') && <span>{TRUST_LABEL[t]}</span>}
    </span>
  );
}

export function TrustPanel({ job, signals }: { job: JobRow; signals: Signal[] }) {
  const t: Trust | 'none' = job.trust ?? 'none';
  const open = t !== 'ok' || signals.length > 0;
  return (
    <div class={`panel trust-panel trust-p-${t}`} id="legitimnost">
      <div class="panel-head">
        <h3>Legitimnost firme</h3>
        <TrustBadge trust={job.trust} />
      </div>
      {signals.length > 0 && (
        <ul class="trust-signals">
          {signals.map((s) => <li class={s.level}>{s.text}</li>)}
        </ul>
      )}
      {job.trust_notes ? (
        <div class="prose" style="padding:0">{raw(renderMarkdown(job.trust_notes, { breaks: true }))}</div>
      ) : (
        <div class="faint" style="font-size:.86rem">Agent još nije proverio ovu firmu. Proverava je sam pri sledećem pokretanju, ili odmah preko dugmeta.</div>
      )}
      <div class="trust-foot">
        {job.trust_checked_at && <span class="faint mono">Provereno {fmtDate(job.trust_checked_at.slice(0, 10))}</span>}
        <AskClaude prompt={PROMPTS.trust(job.id, job.company)} label="Proveri sa Claude-om" />
      </div>
      <details class="trust-more" open={open && t === 'scam'}>
        <summary>Na šta da paziš i ručna ocena</summary>
        <ul class="trust-check">{SCAM_CHECKLIST.map((x) => <li>{x}</li>)}</ul>
        <form method="post" action={`/jobs/${job.id}/trust`} class="trust-form">
          <select name="trust" aria-label="Ocena">
            <option value="" selected={!job.trust}>Nije provereno</option>
            <option value="ok" selected={job.trust === 'ok'}>Firma proverena</option>
            <option value="caution" selected={job.trust === 'caution'}>Oprez</option>
            <option value="scam" selected={job.trust === 'scam'}>Verovatno prevara</option>
          </select>
          <button type="submit" class="btn btn-line btn-sm">Sačuvaj ocenu</button>
        </form>
      </details>
    </div>
  );
}
