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
  var LS_KEY = "jobseeker.calc.v1";
  var DEFAULTS = { rateEUR: 117.2, rateUSD: 101, rateGBP: 134, feePct: 1, pausalMonthly: 60000, accountantMonthly: 0, hours: 40 };

  function load() {
    try { var s = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); return Object.assign({}, DEFAULTS, s); } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save(st) { try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (e) { /* bez storage-a radi i dalje */ } }

  function num(el) { var v = parseFloat(String(el && el.value || "").replace(/\s/g, "").replace(",", ".")); return isFinite(v) ? v : 0; }
  function fmt(v, cur) {
    var digits = cur === "RSD" ? 0 : 0;
    var s = new Intl.NumberFormat("sr-RS", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Math.round(v));
    return s + " " + cur;
  }

  function init() {
    var form = document.getElementById("calc");
    if (!form) return;
    var $ = function (id) { return document.getElementById(id); };
    var st = load();
    ["rateEUR", "rateUSD", "rateGBP", "feePct", "pausalMonthly", "accountantMonthly", "hours"].forEach(function (k) { if ($(k)) $(k).value = st[k]; });

    function rate(cur) { return cur === "RSD" ? 1 : num($("rate" + cur)) || DEFAULTS["rate" + cur]; }

    function render() {
      ["rateEUR", "rateUSD", "rateGBP", "feePct", "pausalMonthly", "accountantMonthly", "hours"].forEach(function (k) { if ($(k)) st[k] = num($(k)); });
      save(st);

      var mode = form.querySelector('input[name="mode"]:checked').value;
      var cur = $("currency").value;
      var period = $("period").value;
      var kind = $("kind").value;
      var amount = num($("amount"));
      var hours = num($("hours")) || 40;
      var r = rate(cur);
      var monthly = toMonthly(amount, period, hours) * r; // RSD mesečno

      $("hoursWrap").hidden = period !== "hour";
      $("kindWrap").hidden = mode !== "emp";
      $("contrOpts").hidden = mode !== "contr";

      var rows = [];
      var other = cur === "RSD" ? "EUR" : cur;
      var ro = rate(other);
      function row(label, rsd, strong) {
        rows.push('<tr' + (strong ? ' class="calc-strong"' : '') + '><td>' + label + '</td><td class="mono">' + fmt(rsd, "RSD") + '</td><td class="mono">' + fmt(rsd / ro, other) + '</td><td class="mono faint">' + fmt(rsd * 12, "RSD") + '</td></tr>');
      }
      var notes = [];

      if (mode === "emp") {
        var res = kind === "net" ? fromNet(monthly) : kind === "gross2" ? fromGross2(monthly) : fromGross1(monthly);
        row("Neto (na ruke)", res.net, true);
        row("Bruto 1", res.gross1);
        row("Bruto 2 (trošak poslodavca)", res.gross2);
        row("Porez 10%", res.tax);
        row("Doprinosi zaposlenog 19,9%", res.empContrib);
        row("Doprinosi poslodavca 15,15%", res.erContrib);
        if (res.minBaseApplied) notes.push("Bruto je ispod najniže osnovice (" + fmt(P.minBase, "RSD") + "), pa se doprinosi računaju na najnižu osnovicu. Za rad sa skraćenim radnim vremenom ovo nije tačno.");
        if (res.maxBaseApplied) notes.push("Bruto je iznad najviše osnovice (" + fmt(P.maxBase, "RSD") + "), pa doprinosi ne rastu dalje. Godišnji porez na dohodak za visoke prihode nije uračunat.");
      } else {
        var c = contractor(monthly, { feePct: num($("feePct")), pausalMonthly: num($("pausalMonthly")), accountantMonthly: num($("accountantMonthly")) });
        row("Ostaje ti (neto)", c.net, true);
        row("Prihod (fakturisano)", c.gross);
        row("Bankarske provizije / konverzija", c.fees);
        row("Paušal: porez + doprinosi", c.pausal);
        if (c.accountant) row("Knjigovođa", c.accountant);
        notes.push("Godišnji promet: " + fmt(c.annualTurnover, "RSD") + " (" + Math.round(c.limitUsage * 100) + "% limita od " + fmt(P.pausalLimit, "RSD") + ").");
        if (c.overLimit) notes.push("Iznad limita za paušal: prelazak na knjige / ličnu zaradu ili d.o.o. menja računicu.");
      }
      if (period !== "month") notes.push("Mesečni iznos: " + fmt(monthly / r, cur) + (cur !== "RSD" ? " = " + fmt(monthly, "RSD") : "") + (period === "hour" ? " (" + hours + " h nedeljno × 52 / 12)" : " (godišnje / 12)") + ".");

      $("calcOut").innerHTML = rows.join("");
      $("calcHead2").textContent = other;
      $("calcNotes").innerHTML = notes.map(function (n) { return "<li>" + n + "</li>"; }).join("");
    }

    form.addEventListener("input", render);
    form.addEventListener("change", render);
    $("resetRates") && $("resetRates").addEventListener("click", function () {
      st = Object.assign({}, DEFAULTS); save(st);
      ["rateEUR", "rateUSD", "rateGBP", "feePct", "pausalMonthly", "accountantMonthly", "hours"].forEach(function (k) { if ($(k)) $(k).value = st[k]; });
      render();
    });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(typeof window !== "undefined" ? window : this);
