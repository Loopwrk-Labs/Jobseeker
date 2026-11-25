// Turns a CV PDF into structured Markdown (headings, roles with dates,
// bullets, skill grids) using pdf.js text positions and fonts. Runs in the
// browser; no server or AI needed. Shared by cv-upload.js and tests.

const MONTH = '(?:jan|feb|mar|apr|maj|may|jun|jul|aug|avg|sep|sept|oct|okt|nov|dec)[a-z]*\\.?';
const DATE_RE = new RegExp(`^(?:${MONTH}\\s*)?(?:19|20)\\d{2}(?:\\s*[-–—]\\s*(?:(?:${MONTH}\\s*)?(?:(?:19|20)\\d{2})?|present|current|now|danas|today|sada)?)?(?:\\s*(?:19|20)\\d{2})?$`, 'i');
const BULLET_RE = /^[•▪●◦‣∙·■□➢►▶✓✔\-–*]\s*/;

function isDate(s) {
  const t = s.trim();
  return t.length <= 40 && (DATE_RE.test(t) || /^\d{1,2}[./]\d{2,4}\s*[-–—]\s*(\d{1,2}[./]\d{2,4}|present|danas)$/i.test(t));
}
function titleCase(s) {
  if (s !== s.toUpperCase() || !/[A-ZČĆŠĐŽ]/.test(s)) return s;
  const low = s.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}
const mode = (arr) => {
  const m = new Map();
  for (const [k, w] of arr) m.set(k, (m.get(k) || 0) + w);
  let best = null, bw = -1;
  for (const [k, w] of m) if (w > bw) { best = k; bw = w; }
  return best;
};

async function pageLines(page) {
  try { await page.getOperatorList(); } catch (e) { /* fonts optional */ }
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const fontName = (f) => { try { return (page.commonObjs.get(f) || {}).name || ''; } catch (e) { return ''; } };
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const h = Math.round((it.height || Math.abs(it.transform[3]) || 10) * 10) / 10;
    const fn = fontName(it.fontName);
    items.push({ x: it.transform[4], y: it.transform[5], w: it.width || it.str.length * h * 0.5, h, str: it.str, bold: /bold|black|heavy|semibold|demi/i.test(fn) });
  }
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const links = [];
  try {
    for (const a of await page.getAnnotations()) {
      if (a.subtype !== 'Link' || !a.url || !/^https?:|^mailto:/i.test(a.url)) continue;
      const [x1, y1, x2, y2] = a.rect;
      const label = items.filter((it) => it.x >= x1 - 2 && it.x <= x2 + 2 && it.y >= y1 - 4 && it.y <= y2 + 4).map((it) => it.str).join(' ').trim();
      links.push({ url: a.url, label });
    }
  } catch (e) { /* no annotations */ }
  const lines = [];
  for (const it of items) {
    const ln = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.h, it.h) * 0.45));
    if (ln) { ln.items.push(it); ln.h = Math.max(ln.h, it.h); } else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    const segs = [];
    for (const it of l.items) {
      const s = segs[segs.length - 1];
      const gap = s ? it.x - s.right : Infinity;
      if (s && gap < Math.max(1.5 * it.h, 14)) {
        s.text += (gap > it.h * 0.15 && !/\s$/.test(s.text) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
        s.right = Math.max(s.right, it.x + it.w);
        s.bold = s.bold && it.bold;
      } else segs.push({ x: it.x, right: it.x + it.w, text: it.str, bold: it.bold });
    }
    for (const s of segs) s.text = s.text.replace(/\s+/g, ' ').trim();
    l.segs = segs.filter((s) => s.text);
    l.x = l.segs[0] ? l.segs[0].x : 0;
    l.right = l.segs.length ? l.segs[l.segs.length - 1].right : 0;
    l.bold = l.segs.every((s) => s.bold);
  }
  return { lines: lines.filter((l) => l.segs.length), width: vp.width, links };
}

/** Two-column layouts (sidebar CVs): find a vertical gutter no text crosses,
 * then read the left column top to bottom, then the right one. */
function splitColumns(lines, width) {
  const segs = lines.flatMap((l) => l.segs);
  if (segs.length < 12) return [lines];
  let best = null;
  for (let c = width * 0.2; c <= width * 0.65; c += 4) {
    const crossing = segs.filter((s) => s.x < c - 2 && s.right > c + 2).length;
    if (crossing > segs.length * 0.03) continue;
    const l = segs.filter((s) => s.right <= c + 2).length;
    const r = segs.filter((s) => s.x >= c - 2).length;
    if (l < segs.length * 0.15 || r < segs.length * 0.15) continue;
    const score = Math.min(l, r);
    if (!best || score > best.score) best = { c, score };
  }
  if (!best) return [lines];
  const cut = best.c;
  const left = [], right = [];
  const part = (l, ss) => ({ ...l, segs: ss, x: ss[0].x, right: ss[ss.length - 1].right, bold: ss.every((s) => s.bold) });
  for (const l of lines) {
    const a = l.segs.filter((s) => s.x < cut), b = l.segs.filter((s) => s.x >= cut);
    if (a.length) left.push(part(l, a));
    if (b.length) right.push(part(l, b));
  }
  // Main column (more text) first: a sidebar is usually contact/skills.
  const len = (ls) => ls.reduce((n, l) => n + l.segs.reduce((m, s) => m + s.text.length, 0), 0);
  return len(right) > len(left) * 1.5 ? [right, left] : [left, right];
}

export async function pdfToMarkdown(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data }).promise;
  const streams = [];
  const links = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await pageLines(await doc.getPage(i));
    for (const k of pg.links) if (!links.some((x) => x.url === k.url)) links.push(k);
    for (const col of splitColumns(pg.lines, pg.width)) streams.push(col);
  }
  const all = streams.flat();
  const body = mode(all.map((l) => [Math.round(l.h), l.segs.reduce((n, s) => n + s.text.length, 0)])) || 11;
  const SECTION = /^(work |professional |relevant )?(experience|employment|career|summary|profile|about( me)?|objective|education|skills|key skills|competencies|core competencies|key competencies|expertise|contact|languages|certifications?|certificates|courses|training|projects|interests|hobbies|awards|achievements|references|tools|technologies|iskustvo|radno iskustvo|obrazovanje|veštine|vestine|kompetencije|kontakt|jezici|sertifikati|projekti|interesovanja|profil|o meni)$/i;

  const blocks = []; // {t:'h1'|'h2'|'h3'|'b'|'p'|'li', text}
  let hadH1 = false;
  let lastGrid = [];
  const JOINER = /(?:\b(?:and|or|of|the|to|with|in|for|across|a|an|by|on|at|from|i|u|za|na|sa|od|do|kroz)|[,;:/&–-])$/i;
  for (const lines of streams) {
    let prev = null;
    const bl = lines.filter((l) => Math.round(l.h) === body);
    const left = bl.length ? Math.min(...bl.map((l) => l.x)) : Math.min(...lines.map((l) => l.x));
    const maxRight = bl.length ? Math.max(...bl.map((l) => l.right)) : Math.max(...lines.map((l) => l.right));
    const full = (l) => l && l.right >= left + (maxRight - left) * 0.72; // the line ran to the margin, so text wraps
    for (const l of lines) {
      const text = l.segs.map((s) => s.text).join(' ');
      const last = blocks[blocks.length - 1];
      const gap = prev ? prev.y - l.y : 0;
      const close = prev && gap > 0 && gap < Math.max(l.h, prev.h) * 1.9;
      const r = l.h / body;
      let m;

      if (r >= 1.8) { blocks.push({ t: 'h1', text: titleCase(text) === text ? text : text }); hadH1 = true; }
      else if (r >= 1.3) {
        if (hadH1 && !SECTION.test(text.trim()) && !blocks.some((b) => b.t === 'h2' || b.t === 'h3' || b.t === 'li') && blocks.length <= 3) blocks.push({ t: 'b', text });
        else blocks.push({ t: 'h2', text: titleCase(text) });
      } else if (l.segs.length >= 2 && isDate(l.segs[l.segs.length - 1].text)) {
        const head = l.segs.slice(0, -1).map((s) => s.text).join(' · ');
        blocks.push({ t: 'h3', text: `${head} — ${l.segs[l.segs.length - 1].text.replace(/\s*[-–—]\s*/, ' – ')}` });
      } else if (l.segs.length >= 2 && l.segs.every((s) => s.text.length < 60)) {
        // A grid row (e.g. skills in 3 columns): each cell is an item.
        const row = [];
        for (const s of l.segs) {
          const c = (s.x + s.right) / 2;
          const wrapped = /^[a-zčćšđž(&]/.test(s.text) && lastGrid.length;
          if (wrapped) {
            const near = lastGrid.reduce((a, b) => (Math.abs(b.c - c) < Math.abs(a.c - c) ? b : a));
            near.b.text += ' ' + s.text;
          } else {
            const b = { t: 'li', text: s.text, grid: true };
            blocks.push(b);
            row.push({ c, b });
          }
        }
        if (row.length) lastGrid = row;
      } else if ((m = text.match(BULLET_RE)) && text.length > m[0].length) {
        blocks.push({ t: 'li', text: text.slice(m[0].length), x: l.x });
      } else if (l.bold && text.length < 140 && Math.round(l.h) >= body) {
        if (last && last.t === 'b' && close) last.text += ' ' + text; else blocks.push({ t: 'b', text });
      } else if (l.x > left + 8 && l.x < left + 60) {
        // Indented body text: bullets drawn as graphics, or their wrapped continuation.
        const cont = last && last.t === 'li' && !last.grid && close && full(prev) && (/^[a-zčćšđž(]/.test(text) || JOINER.test(last.text));
        if (cont) last.text += (last.text.endsWith('-') ? '' : ' ') + text; else blocks.push({ t: 'li', text, x: l.x });
      } else {
        const shortBreak = prev && prev.segs.map((x) => x.text).join(' ').length < 45 && /^[A-ZČĆŠĐŽ0-9+]/.test(text);
        const cont = last && close && full(prev) && !shortBreak && (last.t === 'p' || (last.t === 'li' && !last.grid && /^[a-zčćšđž(]/.test(text)));
        if (cont) last.text += (last.text.endsWith('-') ? '' : ' ') + text; else blocks.push({ t: 'p', text });
      }
      prev = l;
    }
  }

  if (links.length) {
    const md = links.map((k) => {
      const host = k.url.replace(/^mailto:/i, '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
      const label = /linkedin/i.test(k.url) ? 'LinkedIn' : /github/i.test(k.url) ? 'GitHub' : /^mailto:/i.test(k.url) ? host : k.label && k.label.length < 30 ? k.label : host;
      return `[${label}](${k.url})`;
    }).join(' · ');
    const i = blocks.findIndex((b) => b.t === 'p');
    const at = i >= 0 && i <= 3 ? i + 1 : Math.min(1, blocks.length);
    blocks.splice(at, 0, { t: 'p', text: md });
  }

  const out = [];
  let prevT = null;
  for (const b of blocks) {
    const isList = b.t === 'li';
    if (out.length && !(isList && prevT === 'li')) out.push('');
    if (b.t === 'h1') out.push(`# ${b.text}`);
    else if (b.t === 'h2') out.push(`## ${b.text}`);
    else if (b.t === 'h3') out.push(`### ${b.text}`);
    else if (b.t === 'b') out.push(`**${b.text}**`);
    else if (b.t === 'li') out.push(`- ${b.text}`);
    else out.push(b.text);
    prevT = b.t;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
