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
export function CalcPanel({ fx, offer, mode = 'emp', compact = false }: { fx: FxRates; offer?: CalcOffer | null; mode?: 'emp' | 'contr'; compact?: boolean }) {
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
          <label><input type="radio" name="mode" value="emp" checked={mode === 'emp'} /> Plata u Srbiji</label>
          <label><input type="radio" name="mode" value="contr" checked={mode === 'contr'} /> Contractor / paušal</label>
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
          <div class="form-grid three">
            <div class="field">
              <label for="pausalMonthly">Paušal mesečno, RSD</label>
              <input id="pausalMonthly" inputmode="decimal" />
            </div>
            <div class="field">
              <label for="feePct">Provizije i konverzija, %</label>
              <input id="feePct" inputmode="decimal" />
            </div>
            <div class="field">
              <label for="accountantMonthly">Knjigovođa mesečno, RSD</label>
              <input id="accountantMonthly" inputmode="decimal" />
            </div>
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
      <ul id="calcNotes" class="calc-notes faint"></ul>
    </div>
  );
}

export const CALC_FOOTNOTE =
  'Plata 2026: porez 10% na bruto umanjen za neoporezivi iznos 34.221 RSD; doprinosi zaposlenog 19,9% (PIO 14%, zdravstvo 5,15%, nezaposlenost 0,75%), poslodavca 15,15% (PIO 10%, zdravstvo 5,15%); osnovica 51.297–732.820 RSD. Od 1.1.2027. neoporezivi iznos je 37.369 RSD. Godišnji porez na dohodak i olakšice nisu uračunati. Kurs je srednji kurs NBS, osvežava se svakog jutra; ručna izmena kursa važi samo dok je stranica otvorena. Paušal, provizije i procenat iznad oglasa se pamte u ovom browseru.';
