/* Jobseeker: kalkulator bruto/neto (Srbija 2026) + contractor/paušal + godišnje/satnica → mesečno.
   Čista logika je u CALC (testabilna), UI vezivanje je na dnu. */
(function (root) {
  "use strict";

  // Parametri za zarade isplaćene u 2026. (izvori u README / commit poruci)
  var P = {
    year: 2026,
    nonTaxable: 34221,      // neoporezivi iznos zarade, RSD mesečno (2027: 37.369)
    taxRate: 0.10,          // porez na zarade
    empContrib: 0.199,      // zaposleni: PIO 14% + zdravstvo 5,15% + nezaposlenost 0,75%
    erContrib: 0.1515,      // poslodavac: PIO 10% + zdravstvo 5,15%
    minBase: 51297,         // najniža mesečna osnovica doprinosa 2026
    maxBase: 732820,        // najviša mesečna osnovica doprinosa 2026
    pausalLimit: 6000000    // godišnji limit prometa za paušalce, RSD
  };

  function clampBase(g) { return Math.min(Math.max(g, P.minBase), P.maxBase); }

  // Bruto 1 → sve stavke
  function fromGross1(g1) {
    g1 = Math.max(0, g1);
    var base = g1 > 0 ? clampBase(g1) : 0;
    var empC = base * P.empContrib;
    var tax = Math.max(0, g1 - P.nonTaxable) * P.taxRate;
    var net = g1 - empC - tax;
    var erC = base * P.erContrib;
    return { gross1: g1, gross2: g1 + erC, net: net, tax: tax, empContrib: empC, erContrib: erC, minBaseApplied: g1 > 0 && g1 < P.minBase, maxBaseApplied: g1 > P.maxBase };
  }

  // Inverzija bisekcijom (funkcije su monotone)
  function solve(target, key) {
    if (target <= 0) return fromGross1(0);
    var lo = 0, hi = target * 3 + 100000;
    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (fromGross1(mid)[key] < target) lo = mid; else hi = mid;
    }
    return fromGross1((lo + hi) / 2);
  }
  function fromNet(n) { return solve(n, "net"); }
  function fromGross2(g2) { return solve(g2, "gross2"); }

  // Godišnje / satnica → mesečno
  function toMonthly(amount, period, hoursPerWeek) {
    if (period === "year") return amount / 12;
    if (period === "hour") return amount * (hoursPerWeek || 40) * 52 / 12;
    return amount;
  }

  // Contractor / paušalac: mesečni prihod (u RSD) → šta ostaje
  function contractor(monthlyRsd, opts) {
    var feePct = (opts.feePct || 0) / 100;
    var fees = monthlyRsd * feePct;
    var pausal = opts.pausalMonthly || 0;
    var accountant = opts.accountantMonthly || 0;
    var net = monthlyRsd - fees - pausal - accountant;
    var annual = monthlyRsd * 12;
    return { gross: monthlyRsd, fees: fees, pausal: pausal, accountant: accountant, net: net, annualTurnover: annual, overLimit: annual > P.pausalLimit, limitUsage: annual / P.pausalLimit };
  }

  var CALC = { P: P, fromGross1: fromGross1, fromNet: fromNet, fromGross2: fromGross2, toMonthly: toMonthly, contractor: contractor };
  if (typeof module !== "undefined" && module.exports) { module.exports = CALC; return; }
  root.JobseekerCalc = CALC;

  // ---------------- UI ----------------
  function fromMonthly(monthly, period, hoursPerWeek) {
    if (period === "year") return monthly * 12;
    if (period === "hour") return monthly * 12 / 52 / (hoursPerWeek || 40);
    return monthly;
  }

  var LS_KEY = "jobseeker.calc.v2";
  var DEFAULTS = { feePct: 1, pausalMonthly: 60000, accountantMonthly: 0, hours: 40, markup: 15 };
  var KEYS = ["feePct", "pausalMonthly", "accountantMonthly", "hours", "markup"];
  var FALLBACK_RATES = { EUR: 117.2, USD: 101, GBP: 134 };

  function load() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || localStorage.getItem("jobseeker.calc.v1") || "{}"); } catch (e) { s = {}; }
    var out = Object.assign({}, DEFAULTS);
    KEYS.forEach(function (k) { if (typeof s[k] === "number" && isFinite(s[k])) out[k] = s[k]; });
    return out;
  }
  function save(st) { try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (e) { /* radi i bez storage-a */ } }

  function num(el) { var v = parseFloat(String(el && el.value || "").replace(/\s/g, "").replace(",", ".")); return isFinite(v) ? v : 0; }
  function fmt(v, cur) {
    var digits = Math.abs(v) < 100 && cur !== "RSD" ? 2 : 0;
    return new Intl.NumberFormat("sr-RS", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v) + " " + cur;
  }
  function niceRound(v) { return v >= 1000 ? Math.round(v / 50) * 50 : v >= 100 ? Math.round(v) : Math.round(v * 2) / 2; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; }); }

  function init() {
    var form = document.getElementById("calc");
    if (!form) return;
    var $ = function (id) { return document.getElementById(id); };
    var fx = {}; var offer = null;
    try { fx = JSON.parse(form.getAttribute("data-fx") || "{}"); } catch (e) { fx = {}; }
    try { offer = form.getAttribute("data-offer") ? JSON.parse(form.getAttribute("data-offer")) : null; } catch (e) { offer = null; }
    var nbs = Object.assign({}, FALLBACK_RATES, (fx && fx.rates) || {});
    var st = load();
    var manualAmount = false;

    KEYS.forEach(function (k) { if ($(k)) $(k).value = st[k]; });
    function setRates() { ["EUR", "USD", "GBP"].forEach(function (c) { $("rate" + c).value = Math.round(nbs[c] * 10000) / 10000; }); }
    setRates();

    function rate(cur) { return cur === "RSD" ? 1 : num($("rate" + cur)) || nbs[cur] || FALLBACK_RATES[cur]; }

    function rowsFor(mode, monthlyRsd, kind) {
      if (mode === "emp") {
        var r = kind === "net" ? fromNet(monthlyRsd) : kind === "gross2" ? fromGross2(monthlyRsd) : fromGross1(monthlyRsd);
        return { res: r, rows: [
          ["Neto (na ruke)", r.net, true],
          ["Bruto 1", r.gross1],
          ["Bruto 2 (trošak poslodavca)", r.gross2],
          ["Porez 10%", r.tax],
          ["Doprinosi zaposlenog 19,9%", r.empContrib],
          ["Doprinosi poslodavca 15,15%", r.erContrib]
        ] };
      }
      var c = contractor(monthlyRsd, { feePct: num($("feePct")), pausalMonthly: num($("pausalMonthly")), accountantMonthly: num($("accountantMonthly")) });
      return { res: c, rows: [
        ["Ostaje ti (neto)", c.net, true],
        ["Prihod (fakturisano)", c.gross],
        ["Bankarske provizije / konverzija", c.fees],
        ["Paušal: porez + doprinosi", c.pausal],
        ["Knjigovođa", c.accountant]
      ] };
    }

    function render() {
      KEYS.forEach(function (k) { if ($(k)) st[k] = num($(k)); });
      save(st);

      var mode = form.querySelector('input[name="mode"]:checked').value;
      var cur = $("currency").value;
      var period = $("period").value;
      var kind = $("kind").value;
      var hours = num($("hours")) || 40;

      $("hoursWrap").hidden = period !== "hour" && !(offer && offer.period === "hour");
      $("kindWrap").hidden = mode !== "emp";
      $("contrOpts").hidden = mode !== "contr";

      var notes = [];
      var offerMonthly = 0, offerKind = "gross1", offerMin = 0;
      if (offer) {
        var basis = offer.max || offer.min;
        offerKind = offer.kind === "net" ? "net" : "gross1";
        offerMonthly = toMonthly(basis, offer.period, hours) * rate(offer.currency);
        offerMin = offer.min && offer.min !== basis ? toMonthly(offer.min, offer.period, hours) * rate(offer.currency) : 0;
        if (!manualAmount) {
          var target = offerMonthly * (1 + (num($("markup")) || 0) / 100);
          // u izabranoj valuti/periodu; ako je oglas neto a računaš bruto (ili obrnuto), pretvori preko kalkulatora
          if (mode === "emp" && kind !== offerKind) {
            var rr = offerKind === "net" ? fromNet(target) : fromGross1(target);
            target = kind === "net" ? rr.net : kind === "gross2" ? rr.gross2 : rr.gross1;
          }
          $("amount").value = niceRound(fromMonthly(target / rate(cur), period, hours));
        }
      }

      var amount = num($("amount"));
      var monthly = toMonthly(amount, period, hours) * rate(cur);
      var mine = rowsFor(mode, monthly, kind);
      var other = offer ? (offer.currency === "RSD" ? "EUR" : offer.currency) : (cur === "RSD" ? "EUR" : cur);
      var ro = rate(other);
      var html = [];

      if (offer) {
        var theirs = rowsFor(mode, offerMonthly, offerKind);
        $("calcHead").innerHTML = "<tr><th>Mesečno</th><th>Oglas RSD</th><th>Oglas " + other + "</th><th>Tvoja ponuda RSD</th><th>Tvoja ponuda " + other + "</th><th>Razlika</th></tr>";
        mine.rows.forEach(function (r, i) {
          var t = theirs.rows[i];
          if (mode === "contr" && i === 4 && !r[1]) return;
          var diff = r[1] - t[1];
          html.push("<tr" + (r[2] ? ' class="calc-strong"' : "") + "><td>" + r[0] + "</td>" +
            '<td class="mono salary-offer">' + fmt(t[1], "RSD") + '</td><td class="mono salary-offer">' + fmt(t[1] / ro, other) + "</td>" +
            '<td class="mono">' + fmt(r[1], "RSD") + '</td><td class="mono">' + fmt(r[1] / ro, other) + "</td>" +
            '<td class="mono faint">' + (diff >= 0 ? "+" : "") + fmt(diff, "RSD") + "</td></tr>");
        });
        var theirNet = theirs.res.net, myNet = mine.res.net;
        if (theirNet > 0) notes.push("Tvoja ponuda daje " + (myNet >= theirNet ? "+" : "") + fmt(myNet - theirNet, "RSD") + " neto mesečno (" + (myNet >= theirNet ? "+" : "") + Math.round((myNet / theirNet - 1) * 100) + "%) u odnosu na gornju granicu iz oglasa.");
        if (offerMin) {
          var low = rowsFor(mode, offerMin, offerKind).res.net;
          notes.push("Oglas je raspon; računato na gornju granicu. Donja granica daje " + fmt(low, "RSD") + " neto mesečno.");
        }
        if (offer.period === "hour" || period === "hour") notes.push("Satnica je preračunata na " + hours + " h nedeljno × 52 / 12.");
      } else {
        $("calcHead").innerHTML = "<tr><th>Mesečno</th><th>RSD</th><th>" + other + "</th><th>Godišnje RSD</th></tr>";
        mine.rows.forEach(function (r, i) {
          if (mode === "contr" && i === 4 && !r[1]) return;
          html.push("<tr" + (r[2] ? ' class="calc-strong"' : "") + "><td>" + r[0] + '</td><td class="mono">' + fmt(r[1], "RSD") + '</td><td class="mono">' + fmt(r[1] / ro, other) + '</td><td class="mono faint">' + fmt(r[1] * 12, "RSD") + "</td></tr>");
        });
        if (period !== "month") notes.push("Mesečni iznos: " + fmt(monthly / rate(cur), cur) + (cur !== "RSD" ? " = " + fmt(monthly, "RSD") : "") + (period === "hour" ? " (" + hours + " h nedeljno × 52 / 12)" : " (godišnje / 12)") + ".");
      }

      if (mode === "emp") {
        if (mine.res.minBaseApplied) notes.push("Bruto je ispod najniže osnovice (" + fmt(P.minBase, "RSD") + "), pa se doprinosi računaju na najnižu osnovicu. Za skraćeno radno vreme ovo nije tačno.");
        if (mine.res.maxBaseApplied) notes.push("Bruto je iznad najviše osnovice (" + fmt(P.maxBase, "RSD") + "), pa doprinosi dalje ne rastu. Godišnji porez na dohodak nije uračunat.");
      } else {
        notes.push("Godišnji promet: " + fmt(mine.res.annualTurnover, "RSD") + " (" + Math.round(mine.res.limitUsage * 100) + "% limita od " + fmt(P.pausalLimit, "RSD") + ").");
        if (mine.res.overLimit) notes.push("Iznad limita za paušal: prelazak na knjige, ličnu zaradu ili d.o.o. menja računicu.");
      }

      $("calcOut").innerHTML = html.join("");
      $("calcNotes").innerHTML = notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("");
    }

    $("amount").addEventListener("input", function () { manualAmount = true; });
    if ($("markup")) $("markup").addEventListener("input", function () { manualAmount = false; });
    form.addEventListener("input", render);
    form.addEventListener("change", function (e) {
      if (e.target && (e.target.id === "currency" || e.target.id === "period" || e.target.id === "kind" || e.target.name === "mode")) manualAmount = false;
      render();
    });
    $("resetRates").addEventListener("click", function () { setRates(); manualAmount = false; render(); });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(typeof window !== "undefined" ? window : this);
