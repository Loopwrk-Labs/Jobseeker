// Extract the CV text in the browser (pdf.js), so the agent can read it from D1.
const input = document.getElementById('cvFile');
const out = document.getElementById('cvText');
const status = document.getElementById('cvStatus');
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';

if (input && out) {
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > 1500000) status.textContent = 'Upozorenje: PDF je veći od 1,5 MB; sačuvaće se samo tekst.';
    status.textContent = 'Čitam PDF…';
    try {
      const pdfjs = await import(PDFJS + 'pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      const pages = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        let line = '', lastY = null;
        const lines = [];
        for (const it of tc.items) {
          const y = it.transform ? Math.round(it.transform[5]) : null;
          if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { lines.push(line.trim()); line = ''; }
          line += it.str + (it.hasEOL ? '\n' : ' ');
          lastY = y;
        }
        lines.push(line.trim());
        pages.push(lines.filter(Boolean).join('\n'));
      }
      const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!out.value.trim() || confirm('Zameniti postojeći tekst tekstom iz PDF-a?')) out.value = text;
      status.textContent = `Izvučeno ${text.length.toLocaleString('sr-RS')} znakova iz ${doc.numPages} str. Proveri tekst pa sačuvaj.`;
    } catch (e) {
      status.textContent = 'Nisam uspeo da pročitam PDF u browseru. Nalepi tekst CV-a ručno.';
    }
  });
}
