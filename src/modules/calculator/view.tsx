import type { FxRates } from '../fx/service';

export interface CalcOffer {
  min: number;
  max: number;
  currency: string; // EUR | USD | GBP | RSD
  period: string; // month | year | hour
  kind: string; // gross | net
  label: string; // human text, e.g. "$3.500–4.000 / mes. bruto"
}

function fmtRateDate(d: string | null): string {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${dd}.${m}.${y}.`;
}

/**
 * The salary calculator panel. Used standalone on /calculator and on every job
 * page. All math runs in the browser (public/calculator.js); the server only
 * hands over today's NBS rates and, on a job page, the salary from the posting.
 */
export type CalcMode = 'emp' | 'contr' | 'pausal' | 'knjige' | 'doo' | 'frilenser';
const MODES: [Exclude<CalcMode, 'contr'>, string][] = [
  ['emp', 'Plata u Srbiji'],
  ['pausal', 'Paušal'],
  ['knjige', 'Preduzetnik (knjige / PDV)'],
  ['doo', 'DOO'],
  ['frilenser', 'Frilenser, bez firme'],
];
const CHANNEL_OPTS: [string, string][] = [
  ['bank', 'Direktno na banku (SWIFT)'],
  ['wise', 'Wise'],
  ['payoneer', 'Payoneer → banka'],
  ['payoneerAtm', 'Payoneer kartica / bankomat'],
  ['paypal', 'PayPal'],
];

function Num({ id, label }: { id: string; label: string }) {
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} inputmode="decimal" />
    </div>
  );
}

export function CalcPanel({ fx, offer, mode: modeIn = 'emp', compact = false }: { fx: FxRates; offer?: CalcOffer | null; mode?: CalcMode; compact?: boolean }) {
  const mode = modeIn === 'contr' ? 'pausal' : modeIn;
  const fxAttr = JSON.stringify({ date: fx.date, rates: fx.rates });
  const cur = offer?.currency && ['EUR', 'USD', 'GBP', 'RSD'].includes(offer.currency) ? offer.currency : 'EUR';
  const period = offer?.period && ['month', 'year', 'hour'].includes(offer.period) ? offer.period : 'month';
  const kind = offer?.kind === 'net' ? 'net' : 'gross1';
  const rateLine = fx.date ? `Srednji kurs NBS na dan ${fmtRateDate(fx.date)}` : 'Okvirni kursevi (kurs NBS još nije povučen)';

  return (
    <div class={`calc ${compact ? 'calc-compact' : ''}`}>
      <form id="calc" onsubmit="return false" autocomplete="off" data-fx={fxAttr} data-offer={offer ? JSON.stringify(offer) : undefined}>
        {offer && (
          <div class="calc-offer">
            <div class="k">Plata iz oglasa</div>
            <div class="salary-offer big">{offer.label}</div>
          </div>
        )}
        <div class="calc-modes" role="radiogroup" aria-label="Vrsta računice">
          {MODES.map(([v, l]) => <label><input type="radio" name="mode" value={v} checked={mode === v} /> {l}</label>)}
        </div>

        <div class="form-grid three">
          {offer && (
            <div class="field">
              <label for="markup">Iznad oglasa, %</label>
              <input id="markup" inputmode="decimal" />
            </div>
          )}
          <div class="field">
            <label for="amount">{offer ? 'Tvoja ponuda' : 'Iznos'}</label>
            <input id="amount" inputmode="decimal" placeholder="npr. 3000" value={offer ? '' : '3000'} />
          </div>
          <div class="field">
            <label for="currency">Valuta</label>
            <select id="currency">
              {['EUR', 'USD', 'GBP', 'RSD'].map((c) => <option value={c} selected={c === cur}>{c}</option>)}
            </select>
          </div>
          <div class="field">
            <label for="period">Period</label>
            <select id="period">
              <option value="month" selected={period === 'month'}>Mesečno</option>
              <option value="year" selected={period === 'year'}>Godišnje</option>
              <option value="hour" selected={period === 'hour'}>Po satu</option>
            </select>
          </div>
          <div class="field" id="kindWrap">
            <label for="kind">Iznos je</label>
            <select id="kind">
              <option value="gross1" selected={kind === 'gross1'}>Bruto 1 (bruto plata)</option>
              <option value="net" selected={kind === 'net'}>Neto (na ruke)</option>
              <option value="gross2">Bruto 2 (trošak poslodavca)</option>
            </select>
          </div>
          <div class="field" id="hoursWrap" hidden>
            <label for="hours">Sati nedeljno</label>
            <input id="hours" inputmode="decimal" value="40" />
          </div>
        </div>

        <div id="contrOpts" hidden>
          <div class="calc-sub">Kako primaš novac</div>
          <div class="form-grid three">
            <div class="field">
              <label for="channel">Način isplate</label>
              <select id="channel">{CHANNEL_OPTS.map(([v, l]) => <option value={v}>{l}</option>)}</select>
            </div>
            <Num id="channelPct" label="Provizija isplate i konverzije, %" />
            <Num id="platformPct" label="Platforma (npr. Upwork), %" />
            <div class="field" id="atmWrap" hidden><label for="atmPerMonth">Podizanja na bankomatu mesečno</label><input id="atmPerMonth" inputmode="decimal" /></div>
          </div>
          <div class="faint calc-hint" id="channelNote"></div>

          <div id="opt-pausal" hidden>
            <div class="calc-sub">Paušal: troškovi</div>
            <div class="form-grid three">
              <Num id="pausalMonthly" label="Paušal (porez + doprinosi) mesečno, RSD" />
              <Num id="accountantPausal" label="Knjigovođa mesečno, RSD (opciono)" />
            </div>
          </div>
          <div id="opt-knjige" hidden>
            <div class="calc-sub">Preduzetnik na knjigama: troškovi firme</div>
            <div class="form-grid three">
              <Num id="lzGross" label="Lična zarada, bruto 1, RSD" />
              <Num id="accountantKnjige" label="Knjigovođa mesečno, RSD" />
              <Num id="otherKnjige" label="Ostali troškovi (banka, softver), RSD" />
            </div>
            <label class="calc-check"><input type="checkbox" id="vatKnjige" /> U PDV sistemu</label>
          </div>
          <div id="opt-doo" hidden>
            <div class="calc-sub">DOO: troškovi firme</div>
            <div class="form-grid three">
              <Num id="dirGross" label="Plata direktora, bruto 1, RSD" />
              <Num id="accountantDoo" label="Knjigovođa mesečno, RSD" />
              <Num id="otherDoo" label="Ostali troškovi (banka, softver, APR), RSD" />
            </div>
            <label class="calc-check"><input type="checkbox" id="vatDoo" /> U PDV sistemu</label>
          </div>
          <div class="form-grid three" id="vatExtraWrap" hidden>
            <Num id="vatExtra" label="Knjigovođa: doplata za PDV mesečno, RSD" />
          </div>
          <div id="opt-frilenser" hidden>
            <div class="calc-sub">Frilenser bez firme</div>
            <label class="calc-check"><input type="checkbox" id="insuredElsewhere" /> Već imam zdravstveno osiguranje po drugom osnovu (npr. zaposlen)</label>
          </div>
        </div>

        <details class="calc-rates">
          <summary class="faint">Kursevi (RSD za 1 jedinicu) · <span id="rateLine">{rateLine}</span></summary>
          <div class="form-grid three" style="margin-top:8px">
            <div class="field"><label for="rateEUR">EUR</label><input id="rateEUR" inputmode="decimal" /></div>
            <div class="field"><label for="rateUSD">USD</label><input id="rateUSD" inputmode="decimal" /></div>
            <div class="field"><label for="rateGBP">GBP</label><input id="rateGBP" inputmode="decimal" /></div>
          </div>
          <div class="form-actions">
            <button type="button" id="resetRates" class="btn btn-line btn-sm">Vrati kurs NBS</button>
          </div>
        </details>
      </form>

      <div class="table-wrap calc-table">
        <table class="compact calc-out">
          <thead id="calcHead"></thead>
          <tbody id="calcOut"></tbody>
        </table>
      </div>
      <div id="calcCompare"></div>
      <ul id="calcNotes" class="calc-notes faint"></ul>
    </div>
  );
}

export const CALC_FOOTNOTE =
  'Contractor oblici 2026: paušal po rešenju Poreske uprave (limit 6 mil. RSD godišnje); preduzetnik na knjigama sa ličnom zaradom (lična zarada se oporezuje kao plata, ostatak dobiti 10%); DOO: porez na dobit 15% i porez na dividendu 15%, plata direktora kao plata; frilenser bez firme: kvartalno samooporezivanje, povoljniji od modela A (normirani 110.647 RSD, porez 20%) i B (66.733 RSD + 34%, porez 10%), PIO 24%, zdravstvo 10,3%. Provizije za Payoneer, PayPal i Wise su procene; upiši tačne iz svog naloga. Knjigovođa i ostali troškovi su procene, upiši svoje cene. Plata 2026: porez 10% na bruto umanjen za neoporezivi iznos 34.221 RSD; doprinosi zaposlenog 19,9% (PIO 14%, zdravstvo 5,15%, nezaposlenost 0,75%), poslodavca 15,15% (PIO 10%, zdravstvo 5,15%); osnovica 51.297–732.820 RSD. Od 1.1.2027. neoporezivi iznos je 37.369 RSD. Godišnji porez na dohodak i olakšice nisu uračunati. Kurs je srednji kurs NBS, osvežava se svakog jutra; ručna izmena kursa važi samo dok je stranica otvorena. Paušal, provizije i procenat iznad oglasa se pamte u ovom browseru.';
