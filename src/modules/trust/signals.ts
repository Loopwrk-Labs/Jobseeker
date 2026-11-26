// Quick, local scam signals for a job (no network, no AI). The agent does the deep check
// (company registry, site age, reviews, recruiter on LinkedIn) and writes jobs.trust.

export type Trust = 'ok' | 'caution' | 'scam';
export const TRUST_LABEL: Record<Trust | 'none', string> = {
  ok: 'Firma proverena',
  caution: 'Oprez',
  scam: 'Verovatno prevara',
  none: 'Nije provereno',
};

export interface Signal { level: 'red' | 'amber'; text: string }

const FREE_MAIL = /@(gmail|googlemail|outlook|hotmail|live|yahoo|ymail|aol|icloud|me|proton|protonmail|pm|gmx|mail|yandex|zoho)\.(com|me|ru|net|de|ch)$/i;
// ATS / scheduling / job-board domains that legitimately differ from the employer's domain.
const NEUTRAL_DOMAINS = /(greenhouse|lever|ashbyhq|workable|workablemail|teamtailor|teamtailor-mail|recruitee|pinpointhq|breezy|personio|smartrecruiters|myworkday|workday|icims|successfactors|jobvite|bamboohr|rippling|dover|calendly|goodtime|leadconnectorhq|msgsndr|google|linkedin|djinni|himalayas|upwork|wellfound|weworkremotely|remoteok|dynamitejobs|careers-page|infostud|jobrack|indeed|glassdoor)\./i;

const RED_TEXT: [RegExp, string][] = [
  [/telegram|whats ?app|signal (app|messenger)|wickr|\bwechat/i, 'Pominje Telegram, WhatsApp ili sličnu aplikaciju za komunikaciju ili intervju.'],
  [/(buy|purchase|order)\s+(your\s+)?(own\s+)?(equipment|laptop|software)|(kup|nabav)\S*\s+(\S+\s+)?(oprem|laptop|računar)/i, 'Traže da kupiš opremu ili softver (klasična prevara sa čekom za opremu).'],
  [/(training|registration|onboarding|application|certification|processing)\s+fee|\bupfront\s+(payment|fee)|uplat\w* unapred|platiš (obuku|registraciju)/i, 'Traže uplatu (obuka, registracija, taksa) pre posla.'],
  [/\bcheck\b.*\b(deposit|mobile deposit)|deposit (the|a) check|cashier'?s check/i, 'Pominju deponovanje čeka.'],
  [/\b(crypto|bitcoin|usdt|tether|gift ?card)s?\b/i, 'Pominju kripto ili poklon kartice kao način plaćanja.'],
  [/(interview|intervju)\w*\s+(via|over|preko|kroz)\s+(chat|text|sms|poruk)|text[- ]based interview|chat interview/i, 'Intervju samo preko četa ili poruka.'],
  [/(ssn|social security|passport|id card|lična karta|bank (account )?details|broj računa)\b.{0,40}(before|pre|now|odmah|send|pošalj)/i, 'Traže dokumenta ili bankovne podatke pre ugovora.'],
];
const AMBER_TEXT: [RegExp, string][] = [
  [/no (interview|experience) (needed|required)|bez intervjua|hired (immediately|on the spot)|immediate hire/i, 'Zapošljavanje bez intervjua ili „odmah“.'],
  [/reshipping|package (forwarding|handling)|payment processing agent|money transfer agent/i, 'Opis liči na „reshipping“ ili posredovanje novcem.'],
];

function domainOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}
const root = (d: string) => d.split('.').slice(-2).join('.');

export function scamSignals(
  job: { url: string | null; risks: string | null; notes: string | null; next_step: string | null; contract_type: string | null },
  contacts: { name: string; email: string | null }[],
): Signal[] {
  const out: Signal[] = [];
  const text = [job.risks, job.notes, job.next_step, job.contract_type].filter(Boolean).join('\n');
  for (const [re, msg] of RED_TEXT) if (re.test(text)) out.push({ level: 'red', text: msg });
  for (const [re, msg] of AMBER_TEXT) if (re.test(text)) out.push({ level: 'amber', text: msg });

  const jobDomain = domainOf(job.url);
  for (const ct of contacts) {
    const em = (ct.email ?? '').trim().toLowerCase();
    if (!em.includes('@')) continue;
    const d = em.split('@')[1];
    if (FREE_MAIL.test(em)) out.push({ level: 'amber', text: `${ct.name} piše sa besplatne adrese (${d}), a ne sa domena firme.` });
    else if (jobDomain && !NEUTRAL_DOMAINS.test(jobDomain) && !NEUTRAL_DOMAINS.test(d) && root(d) !== root(jobDomain))
      out.push({ level: 'amber', text: `Domen kontakta (${d}) se razlikuje od domena oglasa (${jobDomain}).` });
  }
  return out;
}

// What to watch for, shown on every job: the common remote-job scams.
export const SCAM_CHECKLIST = [
  'Prava firma nikad ne traži novac od kandidata: ni za opremu, obuku, „registraciju“ ni softver.',
  'Ne deponuj ček koji ti pošalju i ne vraćaj „višak“ novca.',
  'Intervju je glasom ili videom, ne samo preko četa (Telegram, WhatsApp, Teams chat).',
  'Recruiter piše sa domena firme, a ne sa Gmail ili Outlook adrese.',
  'Pasoš, ličnu kartu i bankovne podatke daješ tek uz potpisan ugovor, i to kroz HR sistem firme.',
  'Ponuda bez ijednog razgovora ili plata daleko iznad tržišta za taj nivo je znak za oprez.',
];
