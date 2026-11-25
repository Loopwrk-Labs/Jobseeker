// Read the CV PDF in the browser and turn it into structured Markdown, with a live preview.
import { pdfToMarkdown } from '/cv-extract.js';

const input = document.getElementById('cvFile');
const out = document.getElementById('cvText');
const status = document.getElementById('cvStatus');
const preview = document.getElementById('cvPreview');
const PDFJS = '/vendor/pdfjs/'; // pdf.js 4.10.38, self-hosted (Apache-2.0)

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s)
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s"]+|mailto:[^)\s"]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
function md(src) {
  const html = [];
  let list = false;
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { if (list) { html.push('</ul>'); list = false; } continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) { if (list) { html.push('</ul>'); list = false; } const lv = m[1].length + 1; html.push(`<h${lv}>${inline(m[2])}</h${lv}>`); } // same levels as the server renderer
    else if ((m = line.match(/^[-*]\s+(.*)$/))) { if (!list) { html.push('<ul>'); list = true; } html.push(`<li>${inline(m[1])}</li>`); }
    else { if (list) { html.push('</ul>'); list = false; } html.push(`<p>${inline(line)}</p>`); }
  }
  if (list) html.push('</ul>');
  return html.join('');
}
function render() { if (preview && out) preview.innerHTML = out.value.trim() ? md(out.value) : '<p class="faint">Pregled se pojavljuje kad dodaš PDF ili tekst.</p>'; }

if (out) { out.addEventListener('input', render); render(); }

if (input && out) {
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    status.textContent = 'Čitam PDF i slažem sekcije…';
    try {
      const pdfjs = await import(PDFJS + 'pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
      const text = await pdfToMarkdown(pdfjs, new Uint8Array(await f.arrayBuffer()));
      if (!out.value.trim() || confirm('Zameniti postojeći tekst tekstom iz PDF-a?')) out.value = text;
      render();
      const sections = (text.match(/^## /gm) || []).length;
      status.textContent = `Gotovo: ${sections} sekcija, ${(text.match(/^- /gm) || []).length} stavki. Proveri pregled desno, ispravi ako treba, pa sačuvaj.` + (f.size > 1500000 ? ' PDF je veći od 1,5 MB, pa se čuva samo tekst.' : '');
    } catch (e) {
      status.textContent = 'Nisam uspeo da pročitam PDF u browseru. Nalepi tekst CV-a ručno.';
    }
  });
}
