import { Hono } from "hono";
import type { Env, SessionUser } from "../../types";
import { Layout, Topbar } from "../../views/layout";

type Vars = { user: SessionUser | null };
export const calculatorRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const css = `
.calc-modes{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.calc-modes label{display:flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid var(--hairline-strong);border-radius:4px;cursor:pointer;font-size:.86rem}
.calc-modes input{accent-color:currentColor}
.calc-modes label:has(input:checked){background:var(--surface-2);border-color:var(--ink)}
#calc .field input,#calc .field select{width:100%}
.calc-out td{padding:8px 10px}
.calc-out tr.calc-strong td{font-weight:600;font-size:1.02rem}
.calc-notes{margin:12px 0 0;padding-left:18px;font-size:.84rem}
.calc-notes li{margin:4px 0}
.form-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
[hidden]{display:none!important}
@media (max-width:700px){.form-grid.three{grid-template-columns:1fr}}
`;

calculatorRoutes.get("/calculator", (c) => {
  const user = c.get("user") as SessionUser;
  return c.html(
    <Layout title="Kalkulator" active="calculator" user={user}>
      <Topbar crumb={<b>Kalkulator · bruto, neto i contractor</b>} />
      <style>{css}</style>
      <div class="content" style="max-width:1000px">
        <div class="page-head">
          <div>
            <h1>Kalkulator zarade</h1>
            <div class="sub">
              Plata u Srbiji (bruto↔neto), contractor/paušal i godišnje ili po satu → mesečno. Parametri za 2026.
            </div>
          </div>
        </div>

        <form id="calc" class="panel" onsubmit="return false" autocomplete="off">
          <div class="calc-modes" role="radiogroup" aria-label="Vrsta računice">
            <label><input type="radio" name="mode" value="emp" checked /> Plata u Srbiji</label>
            <label><input type="radio" name="mode" value="contr" /> Contractor / paušal</label>
          </div>

          <div class="form-grid three">
            <div class="field">
              <label for="amount">Iznos</label>
              <input id="amount" inputmode="decimal" placeholder="npr. 3000" value="3000" />
            </div>
            <div class="field">
              <label for="currency">Valuta</label>
              <select id="currency">
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
                <option value="RSD">RSD</option>
              </select>
            </div>
            <div class="field">
              <label for="period">Period</label>
              <select id="period">
                <option value="month">Mesečno</option>
                <option value="year">Godišnje</option>
                <option value="hour">Po satu</option>
              </select>
            </div>
            <div class="field" id="kindWrap">
              <label for="kind">Iznos je</label>
              <select id="kind">
                <option value="gross1">Bruto 1 (bruto plata)</option>
                <option value="net">Neto (na ruke)</option>
                <option value="gross2">Bruto 2 (trošak poslodavca)</option>
              </select>
            </div>
            <div class="field" id="hoursWrap" hidden>
              <label for="hours">Sati nedeljno</label>
              <input id="hours" inputmode="decimal" value="40" />
            </div>
          </div>

          <div id="contrOpts" hidden>
            <div class="form-grid three" style="margin-top:6px">
              <div class="field">
                <label for="pausalMonthly">Paušal mesečno, RSD (porez + doprinosi iz rešenja)</label>
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

          <details style="margin-top:10px">
            <summary class="faint" style="cursor:pointer;font-size:.84rem">Kursevi (RSD za 1 jedinicu) · proveri na nbs.rs</summary>
            <div class="form-grid three" style="margin-top:8px">
              <div class="field"><label for="rateEUR">EUR</label><input id="rateEUR" inputmode="decimal" /></div>
              <div class="field"><label for="rateUSD">USD</label><input id="rateUSD" inputmode="decimal" /></div>
              <div class="field"><label for="rateGBP">GBP</label><input id="rateGBP" inputmode="decimal" /></div>
            </div>
            <div class="form-actions">
              <button type="button" id="resetRates" class="btn btn-line btn-sm">Vrati podrazumevane</button>
            </div>
          </details>
        </form>

        <div class="panel flush table-wrap">
          <table class="compact calc-out">
            <thead>
              <tr>
                <th>Mesečno</th>
                <th>RSD</th>
                <th id="calcHead2">EUR</th>
                <th>Godišnje RSD</th>
              </tr>
            </thead>
            <tbody id="calcOut"></tbody>
          </table>
        </div>
        <ul id="calcNotes" class="calc-notes faint"></ul>
        <div class="faint" style="font-size:.76rem;margin-top:10px">
          Plata 2026: porez 10% na bruto umanjen za neoporezivi iznos 34.221 RSD; doprinosi zaposlenog 19,9%
          (PIO 14%, zdravstvo 5,15%, nezaposlenost 0,75%), poslodavca 15,15% (PIO 10%, zdravstvo 5,15%);
          osnovica 51.297–732.820 RSD. Od 1.1.2027. neoporezivi iznos je 37.369 RSD. Godišnji porez na dohodak
          i olakšice nisu uračunati. Kursevi i paušal se čuvaju samo u ovom browseru.
        </div>
      </div>
      <script src="/calculator.js" defer></script>
    </Layout>
  );
});
