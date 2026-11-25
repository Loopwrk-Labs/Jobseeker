// Links that open Claude with a ready-made request. The app cannot start a
// Claude task by itself, so a button opens claude.ai with the message typed
// in; Alex only presses Enter. The same text is copyable as a fallback.

export const DB_LINE =
  'Baza je Cloudflare D1 „jobseeker-db“ (database_id bfde5052-b5ea-42d2-9fce-6cde4978c769), preko Cloudflare konektora. Tekst šalji kroz params, jedna SQL naredba po pozivu sa params. Ne menjaj šemu i ne diraj users/sessions. Nikad ne šalji mejlove ni prijave.';

export const TASKS = {
  gmail: { id: 'trig_018XMfyQUMJarDDQMask9FoQ', name: 'Jobseeker – brza Gmail provera' },
  agent: { id: 'trig_01LHhVjUsDnt7YjLv3T2QYQ9', name: 'Jutarnji agent za poslove (računar)' },
};

export function claudeUrl(prompt: string): string {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}

export const PROMPTS = {
  gmail: () => `Pokreni moj zakazani zadatak „${TASKS.gmail.name}“ (${TASKS.gmail.id}) i javi mi kad završi.`,
  agent: (focus?: string) =>
    `Pokreni moj zakazani zadatak „${TASKS.agent.name}“ (${TASKS.agent.id})${focus ? ` sa dodatnom porukom: ${focus}` : ''}.`,
  cv: (id: number) =>
    `Jobseeker: pročitaj CV verziju #${id} (tabela cv_versions, kolona content) i ažuriraj moj profil i kriterijume u app_settings ('profile' i 'criteria'). Profil: iskustvo, rezultati, veštine i obrazovanje, tačno kako piše u CV-u; ne izmišljaj. Kriterijume samo dopuni ako CV otkriva nešto novo (uloge, domeni, alati); postojeća pravila ne briši. Popuni i kolonu focus za tu CV verziju (kada je koristiti). Pokaži mi šta si promenio. ${DB_LINE}`,
  cvFormat: (id: number) =>
    `Jobseeker: sredi CV verziju #${id} (tabela cv_versions, kolona content). Prepiši je u čist Markdown, bez menjanja ili dodavanja činjenica: \`# Ime\`, ispod kontakt i linkovi, pa jedna rečenica titule u **bold**; zatim sekcije \`## Summary\`, \`## Key competencies\` (lista), \`## Experience\` (za svaku ulogu \`### Firma — Mesec GGGG – Mesec GGGG\`, ispod **Naziv uloge**, pa stavke sa „- “), \`## Education\`, i ostale sekcije koje postoje u originalu (Certifications, Languages, Tools…). Spoji prelomljene redove, ukloni duplikate i višak razmaka, ispravi očigledne greške u prelomu teksta. Upiši rezultat nazad u content (jedna UPDATE naredba sa params) i postavi updated_at = datetime('now'). Pokaži mi kratko šta si promenio. ${DB_LINE}`,
  stories: () =>
    `Jobseeker: na osnovu mog profila (app_settings 'profile'), CV verzija (cv_versions) i odgovora koje sam već dao (answers, packages.answers), napravi 6–8 STAR priča i upiši ih u tabelu stories (title, tags, situation, task, action, result, source='agent'). Pokrij: liderstvo, konflikt, isporuka pod pritiskom, neuspeh i pouka, automatizacija/proces, rad sa klijentom, odluka bez odobrenja, upravljanje prioritetima. Samo činjenice iz profila; gde fali konkretan detalj, stavi [zagradu]. Rezultate piši kao u profilu (npr. „cut standard implementation time by 50%“). Ne pominji Loopwrk. Prvo proveri postojeće priče da ne dupliraš. ${DB_LINE}`,
  answersImport: () =>
    `Jobseeker: prođi kroz packages.answers svih poslova i izvuci pojedinačna pitanja i odgovore u tabelu answers (question, answer, tags, job_id, company, source='agent'). Preskoči duplikate (isto pitanje i isti odgovor). Javi koliko si dodao. ${DB_LINE}`,
  salary: (jobId: number, company: string, title: string) =>
    `Jobseeker: istraži tržišnu platu za poziciju „${title}“ u firmi ${company} (posao #${jobId}) za remote rad iz Srbije. Pogledaj Levels.fyi, Glassdoor, Payscale, Himalayas, oglase sa istom ulogom i nivoom, i platu iz samog oglasa (jobs.salary_*). Upiši u salary_research (job_id=${jobId}): market_min, market_max, market_currency, market_period, market_sources (Markdown lista linkova koje si stvarno otvorio), counter_amount (predlog iznad gornje granice oglasa ako je opravdano mojim iskustvom) i counter_text (2–4 rečenice na engleskom za pregovore, bez izmišljenih činjenica; rezultati kao u profilu). Napiši mi i kratko obrazloženje. ${DB_LINE}`,
  analyze: (interviewId: number, company: string) =>
    `Jobseeker: analiziraj moj intervju #${interviewId} u ${company}. Pročitaj interviews, recordings (transcript, summary, action_items) za taj intervju, moj feedback (interview_feedback), posao (jobs) i paket (packages). Upiši u recordings.analysis (za taj interview_id) Markdown na srpskom sa delovima: **Kako sam se pokazao** (konkretno, sa citatima iz transkripta), **Šta da popravim**, **Pitanja koja su postavili** (i kratko kako sam odgovorio), **Signali o firmi i intervjueru** (uporedi sa mojim feedbackom), **Sledeći koraci**. Zatim dodaj u tabelu answers svako važno pitanje sa boljim odgovorom na engleskom (source='agent', job_id, company), bez duplikata, i predloži mi izmene STAR priča (stories) ako vidiš bolji primer. Rezultate piši kao u profilu; ništa ne izmišljaj. ${DB_LINE}`,
  prep: (jobId: number, company: string, title: string) =>
    `Jobseeker: pripremi me za intervju za „${title}“ u ${company} (posao #${jobId}). Pročitaj posao, paket, intervjue (interviews) i kontakte (contacts) iz baze, istraži firmu na webu, pa mi daj: 5 verovatnih pitanja sa predlogom odgovora iz mojih STAR priča (stories), 3 pitanja koja ja treba da postavim i šta da istaknem. Ništa ne upisuj osim ako te zamolim. ${DB_LINE}`,
};

/** A pair of controls: open Claude with the prompt, or copy it. */
export function AskClaude({ prompt, label, solid = false }: { prompt: string; label: string; solid?: boolean }) {
  return (
    <span class="ask-claude">
      <a href={claudeUrl(prompt)} target="_blank" rel="noopener noreferrer" class={`btn ${solid ? 'btn-solid' : 'btn-line'} btn-sm`}>
        {label} ↗
      </a>
      <button type="button" class="btn btn-line btn-sm ask-copy" data-copy-text={prompt} title="Kopiraj poruku za Claude">
        Kopiraj
      </button>
    </span>
  );
}
