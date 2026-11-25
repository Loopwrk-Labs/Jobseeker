// Turns the agent's free-text "risks" into structured facts for the job page.
// The agent writes lines like "Sastanci: srednje (webinari i 1x1)"; several
// can share a line ("Isključivost: nije pomenuto. Sastanci: malo."). Known keys
// become fact tiles, everything else stays as a list of notes.

export type Tone = 'good' | 'warn' | 'bad' | null;

export interface Fact {
  key: string;
  label: string;
  head: string; // short headline, e.g. "lako"
  detail: string | null; // the rest, e.g. "Teamtailor forma: CV…"
  tone: Tone;
}

export interface Note {
  label: string | null;
  text: string;
}

const FACT_KEYS: { key: string; label: string; match: string[] }[] = [
  { key: 'group', label: 'Grupa', match: ['Grupa'] },
  { key: 'apply', label: 'Prijava', match: ['Prijava'] },
  { key: 'auto', label: 'Automatizabilno', match: ['Automatizabilno'] },
  { key: 'excl', label: 'Isključivost', match: ['Isključivost', 'Iskljucivost'] },
  { key: 'meet', label: 'Sastanci', match: ['Sastanci'] },
  { key: 'hours', label: 'Radno vreme', match: ['Radno vreme'] },
  { key: 'mon', label: 'Monitoring', match: ['Monitoring'] },
  { key: 'ai', label: 'AI alati', match: ['AI alati'] },
];
const PAY_KEYS = ['Plata', 'Satnica'];
const NOTE_KEYS = ['Napomena', 'Praznina', 'Uslovi', 'Proces', 'Domen', 'Klijent', 'Upwork filter', 'Lokacija', 'Ugovor', 'Alati', 'Plusevi za Alexa'];

const ALL = [...FACT_KEYS.flatMap((f) => f.match), ...PAY_KEYS, ...NOTE_KEYS];
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "Key:" at line start or after a sentence end.
const SPLIT = new RegExp(`(?:^|(?<=[.;])\\s+)(${ALL.map(escRe).join('|')})\\s*:\\s*`, 'g');

function toneFor(key: string, v: string): Tone {
  const s = v.toLowerCase();
  const starts = (...w: string[]) => w.some((x) => s.startsWith(x));
  switch (key) {
    case 'apply':
      return starts('lako') ? 'good' : starts('srednje') ? 'warn' : starts('teško', 'tesko') ? 'bad' : null;
    case 'auto':
      return starts('visoko') ? 'good' : starts('srednje') ? 'warn' : starts('nisko') ? 'bad' : null;
    case 'excl':
      if (/nije pomenut/.test(s)) return null;
      if (/dozvoljeno/.test(s) && !/zabranjeno/.test(s)) return 'good';
      return /zabranjeno/.test(s) ? 'bad' : null;
    case 'meet':
      return starts('malo') ? 'good' : starts('mnogo') ? 'bad' : starts('srednje') ? 'warn' : null;
    case 'mon':
      return starts('da') ? 'bad' : null;
    case 'hours':
      return starts('fleksibil') ? 'good' : starts('fiksno') ? 'warn' : null;
    default:
      return null;
  }
}

function splitHead(v: string): { head: string; detail: string | null } {
  const m = v.match(/^([^–(:;,]+?)\s*(?:[–(:;,]|\s-\s|\.\s)\s*(.+)$/s);
  if (!m || m[1].length > 42) return { head: v.replace(/\.$/, ''), detail: null };
  let detail = m[2].trim().replace(/\.$/, '');
  if (v.includes('(') && detail.endsWith(')') && !detail.includes('(')) detail = detail.slice(0, -1);
  return { head: m[1].trim(), detail: detail || null };
}

export function parseRisks(text: string | null): { facts: Fact[]; notes: Note[]; pay: string | null } {
  const facts: Fact[] = [];
  const notes: Note[] = [];
  let pay: string | null = null;
  if (!text) return { facts, notes, pay };

  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*[-•*]\s*/, '').trim();
    if (!line) continue;
    const parts: { key: string | null; val: string }[] = [];
    let last = 0;
    let curKey: string | null = null;
    SPLIT.lastIndex = 0;
    for (let m; (m = SPLIT.exec(line)); ) {
      const before = line.slice(last, m.index).trim();
      if (before || curKey) parts.push({ key: curKey, val: before });
      curKey = m[1];
      last = SPLIT.lastIndex;
    }
    parts.push({ key: curKey, val: line.slice(last).trim() });

    for (const p of parts) {
      if (!p.val && !p.key) continue;
      const val = p.val.replace(/\s+$/, '');
      if (!p.key) {
        notes.push({ label: null, text: val });
        continue;
      }
      if (PAY_KEYS.includes(p.key)) {
        pay = pay ? `${pay}; ${val}` : val;
        continue;
      }
      const fk = FACT_KEYS.find((f) => f.match.includes(p.key!));
      if (fk && !facts.some((f) => f.key === fk.key)) {
        let v = val;
        // "Grupa: Junior ops/admin. Onboarding novih korisnika…" → keep the rest as a note.
        if (fk.key === 'group') {
          const i = v.search(/\.\s+[A-ZČĆŠĐŽ]/);
          if (i > 0) {
            notes.push({ label: null, text: v.slice(i + 1).trim() });
            v = v.slice(0, i);
          }
          facts.push({ key: fk.key, label: fk.label, head: v.replace(/\.$/, ''), detail: null, tone: null });
          continue;
        }
        const { head, detail } = splitHead(v);
        facts.push({ key: fk.key, label: fk.label, head, detail, tone: toneFor(fk.key, v) });
      } else {
        notes.push({ label: p.key, text: val });
      }
    }
  }
  facts.sort((a, b) => FACT_KEYS.findIndex((f) => f.key === a.key) - FACT_KEYS.findIndex((f) => f.key === b.key));
  return { facts, notes, pay };
}
