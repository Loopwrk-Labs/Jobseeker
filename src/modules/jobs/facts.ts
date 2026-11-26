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

// ------------------------------------------------------------------ working hours → Belgrade time

export interface HoursInfo {
  zone: string | null; // label as written, e.g. "New York"
  diffH: number | null; // Belgrade minus that zone, in hours (+6 = Belgrade is 6 h ahead)
  span: string | null; // posting's hours in its zone, "9:00–17:00"
  local: string | null; // same hours in Belgrade, "15:00–23:00"
  mode: 'full' | 'overlap' | 'flex' | null;
  overlapH: number | null;
}

const ZONES: [RegExp, string, string][] = [
  [/new york|\bE[SD]?T\b|eastern/i, 'America/New_York', 'US Eastern'],
  [/chicago|\bC[SD]?T\b(?!\s*\+)|central time/i, 'America/Chicago', 'US Central'],
  [/denver|\bM[SD]?T\b|mountain/i, 'America/Denver', 'US Mountain'],
  [/los angeles|california|\bP[SD]?T\b|pacific/i, 'America/Los_Angeles', 'US Pacific'],
  [/london|\bUK\b|\bBST\b|\bGMT\b(?!\s*[+-])/i, 'Europe/London', 'London'],
  [/dubai|\bGST\b|gmt\s*\+\s*4\b/i, 'Asia/Dubai', 'Dubai'],
  [/indi[ajo]|\bIST\b|kolkata|bangalore/i, 'Asia/Kolkata', 'India'],
  [/sydney|\bAEST\b|\bAEDT\b/i, 'Australia/Sydney', 'Sydney'],
  [/singapore|\bSGT\b/i, 'Asia/Singapore', 'Singapore'],
  [/\bCET\b|\bCEST\b|beograd|belgrade|berlin|europsko vreme/i, 'Europe/Belgrade', 'CET'],
];

function tzOffsetMin(tz: string, at = new Date()): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(at)) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

const fmtHM = (m: number) => {
  const x = ((m % 1440) + 1440) % 1440;
  return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
};

export function parseHours(text: string): HoursInfo {
  const t = text;
  const info: HoursInfo = { zone: null, diffH: null, span: null, local: null, mode: null, overlapH: null };

  // Mode: must match the whole working day, only overlap some hours, or flexible.
  if (/fleksib|flexib|async|any time|bilo kad|own hours/i.test(t)) info.mode = 'flex';
  if (/overlap|preklap|core hours|at least \d|najmanje \d|minimum \d|min\.? \d/i.test(t)) info.mode = 'overlap';
  if (!info.mode && /fiksno|fixed|full|business hours|radno vreme firme|9\s*(?:am)?\s*[-–]\s*5\s*pm/i.test(t)) info.mode = 'full';
  const ov = t.match(/(\d+(?:[.,]\d)?)\s*(?:h|sat[ai]?|hours?)\s*(?:of\s+)?(?:overlap|preklap)/i) ?? t.match(/(?:overlap|preklapanj[ae])\s+(?:of\s+|od\s+)?(?:at least\s+|najmanje\s+|min\.?\s+)?(\d+(?:[.,]\d)?)\s*(?:h\b|sat|hours?)(?!\s*(?:US|CET|ET|PT|GMT|UTC|New|London))/i);
  if (ov) info.overlapH = Number(ov[1].replace(',', '.'));

  // Zone: explicit UTC/GMT offset, or a known zone name.
  let tz: string | null = null;
  let fixedOff: number | null = null;
  const off = t.match(/(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i);
  if (off) {
    fixedOff = (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3] ?? 0));
    info.zone = off[0].toUpperCase().replace(/\s+/g, '');
  } else {
    const z = ZONES.find(([re]) => re.test(t));
    if (z) { tz = z[1]; info.zone = z[2]; }
  }
  const zoneOff = fixedOff ?? (tz ? tzOffsetMin(tz) : null);
  const bgOff = tzOffsetMin('Europe/Belgrade');
  if (zoneOff != null) info.diffH = (bgOff - zoneOff) / 60;

  // Hours: first "9–17", "9:30-18:00", "9am–5pm", "6–14 h".
  const r = t.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|h)?\s*(?:[-–—]|do|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|h)?/i);
  if (r) {
    const h = (hh: string, ap?: string) => {
      let x = Number(hh) % 24;
      if (ap?.toLowerCase() === 'pm' && x < 12) x += 12;
      if (ap?.toLowerCase() === 'am' && x === 12) x = 0;
      return x;
    };
    const ap2 = r[6]?.toLowerCase();
    const ap1 = r[3]?.toLowerCase() ?? (ap2 === 'pm' && Number(r[1]) > Number(r[4]) ? 'am' : undefined);
    const s = h(r[1], ap1) * 60 + Number(r[2] ?? 0);
    const e = h(r[4], ap2) * 60 + Number(r[5] ?? 0);
    if (s !== e && Number(r[1]) <= 24 && Number(r[4]) <= 24) {
      info.span = `${fmtHM(s)}–${fmtHM(e)}`;
      if (info.diffH != null) info.local = `${fmtHM(s + info.diffH * 60)}–${fmtHM(e + info.diffH * 60)}`;
    }
  }
  // "until 14h US Eastern" without a start: show the end in Belgrade time.
  if (!info.span && info.diffH != null) {
    const u = t.match(/(?:\bdo\b|until|till|by)\s*~?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|h)?/i);
    if (u) {
      let x = Number(u[1]) % 24;
      if (u[3]?.toLowerCase() === 'pm' && x < 12) x += 12;
      const m = x * 60 + Number(u[2] ?? 0);
      info.span = `do ${fmtHM(m)}`;
      info.local = `do ${fmtHM(m + info.diffH * 60)}`;
    }
  }
  return info;
}
