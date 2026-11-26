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
    pausalLimit: 6000000,   // godišnji limit prometa za paušalce, RSD
    // Godišnji porez na dohodak: prag = 3 prosečne godišnje zarade. Poslednji objavljeni (za 2025): 5.439.096 RSD.
    annualThreshold: 5439096,
    avgAnnual: 1813032,
    soleProfitTax: 0.10,    // preduzetnik knjigaš: porez na dobit (prihodi od samostalne delatnosti)
    corpTax: 0.15,          // DOO: porez na dobit pravnih lica
    dividendTax: 0.15,      // porez na dividendu za fizičko lice rezidenta
    minWageGross: 88265     // minimalna bruto zarada 2026 za mesec od 176 sati
  };

  // Gruba procena godišnjeg poreza na dohodak za zaposlene (ZPDG čl. 87–88):
  // osnovica = godišnji neto − prag; lični odbitak 40% prosečne godišnje zarade (najviše 50% osnovice);
  // 10% do 6 prosečnih godišnjih zarada, 15% iznad. Bez olakšice za mlađe od 40 i izdržavane članove.
  function annualTax(monthlyNet) {
    var base = monthlyNet * 12 - P.annualThreshold;
    if (base <= 0) return 0;
    var taxable = base - Math.min(0.4 * P.avgAnnual, 0.5 * base);
    var band = 6 * P.avgAnnual - P.annualThreshold;
    return Math.min(taxable, band) * 0.10 + Math.max(0, taxable - band) * 0.15;
  }

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

  // ---- Contractor oblici: mesečni prihod u RSD → šta ostaje ----
  function base(monthlyRsd, o) {
    var fees = monthlyRsd * ((o.feePct || 0) / 100);
    return { gross: monthlyRsd, fees: fees, annualTurnover: monthlyRsd * 12 };
  }

  // Paušal: fiksni porez i doprinosi po rešenju Poreske uprave; limit 6 mil. godišnje.
  function pausal(monthlyRsd, o) {
    var b = base(monthlyRsd, o);
    var pausal = o.pausalMonthly || 0, acct = o.accountantPausal || 0;
    var net = monthlyRsd - b.fees - pausal - acct;
    return { form: "pausal", gross: monthlyRsd, net: net, annualTurnover: b.annualTurnover, overLimit: b.annualTurnover > P.pausalLimit, limitUsage: b.annualTurnover / P.pausalLimit,
      rows: [["Prihod (fakturisano)", monthlyRsd], ["Provizije: platforma, isplata, konverzija", b.fees], ["Paušal: porez + doprinosi", pausal], ["Knjigovođa", acct]] };
  }

  // Preduzetnik knjigaš sa ličnom zaradom: lična zarada se oporezuje kao plata, a ostatak dobiti 10% i dalje je slobodan.
  function knjige(monthlyRsd, o) {
    var b = base(monthlyRsd, o);
    var acct = (o.accountantKnjige || 0) + (o.vatKnjige ? (o.vatExtra || 0) : 0);
    var other = o.otherKnjige || 0;
    var lz = fromGross1(o.lzGross || 0);
    var lzCost = lz.gross2 - lz.net;
    var profit = monthlyRsd - b.fees - acct - other - lz.gross2;
    var tax = Math.max(0, profit) * P.soleProfitTax;
    var net = lz.net + profit - tax;
    return { form: "knjige", gross: monthlyRsd, net: net, profit: profit, annualTurnover: b.annualTurnover, vat: !!o.vatKnjige,
      rows: [["Prihod (fakturisano)", monthlyRsd], ["Provizije: platforma, isplata, konverzija", b.fees], ["Knjigovođa" + (o.vatKnjige ? " (sa PDV evidencijom)" : ""), acct], ["Ostali troškovi firme", other],
        ["Lična zarada: porez + doprinosi", lzCost], ["Porez na dobit 10%", tax]] };
  }

  // DOO: plata direktora, porez na dobit 15%, ostatak kao dividenda uz porez 15%.
  function doo(monthlyRsd, o) {
    var b = base(monthlyRsd, o);
    var acct = (o.accountantDoo || 0) + (o.vatDoo ? (o.vatExtra || 0) : 0);
    var other = o.otherDoo || 0;
    var dir = fromGross1(o.dirGross || 0);
    var dirCost = dir.gross2 - dir.net;
    var profit = monthlyRsd - b.fees - acct - other - dir.gross2;
    var corp = Math.max(0, profit) * P.corpTax;
    var div = profit - corp;
    var divTax = Math.max(0, div) * P.dividendTax;
    var net = dir.net + div - divTax;
    return { form: "doo", gross: monthlyRsd, net: net, profit: profit, annualTurnover: b.annualTurnover, vat: !!o.vatDoo,
      rows: [["Prihod (fakturisano)", monthlyRsd], ["Provizije: platforma, isplata, konverzija", b.fees], ["Knjigovođa" + (o.vatDoo ? " (sa PDV evidencijom)" : ""), acct], ["Ostali troškovi firme", other],
        ["Plata direktora: porez + doprinosi", dirCost], ["Porez na dobit 15%", corp], ["Porez na dividendu 15%", divTax]] };
  }

  // Frilenser bez firme (fizičko lice, samooporezivanje kvartalno). Bira povoljniji model A/B.
  // A: normirani 110.647/kvartal, porez 20%; B: 66.733 + 34% prihoda, porez 10%. PIO 24% (B: min 36.934/kv.), zdravstvo 10,3% (min 7.003/kv.) ako nisi osiguran po drugom osnovu.
  var FR = { aFixed: 110647, bFixed: 66733, bPct: 0.34, aTax: 0.20, bTax: 0.10, pio: 0.24, health: 0.103, bPioMinQ: 36934, healthMinQ: 7003 };
  function frilenser(monthlyRsd, o) {
    var b = base(monthlyRsd, o);
    var q = (monthlyRsd - b.fees) * 3; // prihod u kvartalu, posle provizija
    function model(m) {
      var norm = m === "A" ? FR.aFixed : FR.bFixed + FR.bPct * q;
      var osn = Math.max(0, q - norm);
      var tax = osn * (m === "A" ? FR.aTax : FR.bTax);
      var pio = osn * FR.pio; if (m === "B") pio = Math.max(pio, FR.bPioMinQ);
      var health = o.insuredElsewhere ? 0 : Math.max(osn * FR.health, FR.healthMinQ);
      return { m: m, tax: tax / 3, pio: pio / 3, health: health / 3, total: (tax + pio + health) / 3 };
    }
    var A = model("A"), B = model("B"), best = A.total <= B.total ? A : B;
    var net = monthlyRsd - b.fees - best.total;
    return { form: "frilenser", gross: monthlyRsd, net: net, model: best.m, annualTurnover: b.annualTurnover,
      rows: [["Prihod (fakturisano)", monthlyRsd], ["Provizije: platforma, isplata, konverzija", b.fees], ["Porez (model " + best.m + ")", best.tax], ["PIO doprinos 24%", best.pio], ["Zdravstveno 10,3%", best.health]] };
  }

  // Načini isplate: procena ukupnih provizija u % (prijem + konverzija + isplata). Uvek se može prepraviti ručno.
  var CHANNELS = {
    bank:     { label: "Direktno na banku (SWIFT)", pct: 1.0, note: "Banka obično uzima naknadu za priliv i razliku u kursu pri konverziji." },
    wise:     { label: "Wise", pct: 1.0, note: "Wise konvertuje po srednjem kursu uz proviziju od oko 0,6–0,8% i malu fiksnu naknadu." },
    payoneer: { label: "Payoneer → banka", pct: 3.0, note: "Payoneer: prijem na račun u stranoj valuti do 1%, isplata na banku uz konverziju 1,2–4%." },
    payoneerAtm: { label: "Payoneer kartica / bankomat", pct: 2.8, atm: true, note: "Payoneer kartica: 2,50 EUR po podizanju + do 1,8% (bez konverzije), do 3,5% uz konverziju; godišnja članarina 29,95 USD." },
    paypal:   { label: "PayPal", pct: 8.0, note: "PayPal: komercijalna uplata oko 3,49% + fiksno + dodatak za inostranstvo, plus 3–4% na konverziju valute." }
  };

  var FORMS = { pausal: pausal, knjige: knjige, doo: doo, frilenser: frilenser };
  var FORM_LABEL = { pausal: "Paušal", knjige: "Preduzetnik (knjige)", doo: "DOO", frilenser: "Frilenser, bez firme" };
  // stara imena (contractor) i dalje rade
  function contractor(monthlyRsd, o) { return pausal(monthlyRsd, o); }

  var CALC = { P: P, FR: FR, CHANNELS: CHANNELS, pausal: pausal, knjige: knjige, doo: doo, frilenser: frilenser, annualTax: annualTax, parseNum: parseNum, fromGross1: fromGross1, fromNet: fromNet, fromGross2: fromGross2, toMonthly: toMonthly, contractor: contractor };
  if (typeof module !== "undefined" && module.exports) { module.exports = CALC; return; }
  root.JobseekerCalc = CALC;


  // ---------------- UI ----------------
  // Prihvata "4000", "4.000", "4 000", "4,000", "3.500,50", "1,5": tačka/zarez ispred tačno 3 cifre je hiljadarka.
  function parseNum(raw) {
    var t = String(raw || "").replace(/[\s ']/g, "");
    if (!t) return 0;
    var lastDot = t.lastIndexOf("."), lastComma = t.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
      var dec = lastDot > lastComma ? "." : ",";
      t = t.split(dec === "." ? "," : ".").join("").replace(dec, ".");
    } else {
      var sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : "";
      if (sep) {
        var parts = t.split(sep);
        var thousands = parts.length > 2 || (parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== "0");
        t = thousands ? parts.join("") : parts.join(".");
      }
    }
    var v = parseFloat(t);
    return isFinite(v) ? v : 0;
  }

  function fromMonthly(monthly, period, hoursPerWeek) {
    if (period === "year") return monthly * 12;
    if (period === "hour") return monthly * 12 / 52 / (hoursPerWeek || 40);
    return monthly;
  }

  var LS_KEY = "jobseeker.calc.v3";
  var DEFAULTS = {
    platformPct: 0, channelPct: 1, atmPerMonth: 2, hours: 40, markup: 15,
    pausalMonthly: 60000, accountantPausal: 0,
    lzGross: 51297, accountantKnjige: 15000, otherKnjige: 3000,
    dirGross: 88265, accountantDoo: 25000, otherDoo: 5000,
    vatExtra: 8000
  };
  var KEYS = Object.keys(DEFAULTS);
  var CHECKS = ["vatKnjige", "vatDoo", "insuredElsewhere"];
  var FALLBACK_RATES = { EUR: 117.2, USD: 101, GBP: 134 };
  var CONTR = ["pausal", "knjige", "doo", "frilenser"];

  function load() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch (e) { s = {}; }
    if (!s || typeof s !== "object") s = {};
    // prenesi stara podešavanja (v2)
    try { var old = JSON.parse(localStorage.getItem("jobseeker.calc.v2") || "{}"); if (s.pausalMonthly == null && old.pausalMonthly != null) { s.pausalMonthly = old.pausalMonthly; s.markup = old.markup; s.hours = old.hours; } } catch (e) { /* ignore */ }
    var out = Object.assign({}, DEFAULTS);
    KEYS.forEach(function (k) { if (typeof s[k] === "number" && isFinite(s[k])) out[k] = s[k]; });
    CHECKS.forEach(function (k) { out[k] = !!s[k]; });
    out.channel = CHANNELS[s.channel] ? s.channel : "bank";
    return out;
  }
  function save(st) { try { localStorage.setItem(LS_KEY, JSON.stringify(st)); } catch (e) { /* radi i bez storage-a */ } }

  function num(el) { return parseNum(el && el.value); }
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
    CHECKS.forEach(function (k) { if ($(k)) $(k).checked = st[k]; });
    if ($("channel")) $("channel").value = st.channel;
    function setRates() { ["EUR", "USD", "GBP"].forEach(function (c) { $("rate" + c).value = Math.round(nbs[c] * 10000) / 10000; }); }
    setRates();

    function rate(cur) { return cur === "RSD" ? 1 : num($("rate" + cur)) || nbs[cur] || FALLBACK_RATES[cur]; }

    function opts() {
      var ch = CHANNELS[$("channel").value] || CHANNELS.bank;
      var atmFee = ch.atm ? (num($("atmPerMonth")) || 0) * 2.5 * rate("EUR") : 0; // 2,50 EUR po podizanju
      return {
        feePct: (num($("platformPct")) || 0) + (num($("channelPct")) || 0),
        atmFee: atmFee,
        pausalMonthly: num($("pausalMonthly")), accountantPausal: num($("accountantPausal")),
        lzGross: num($("lzGross")), accountantKnjige: num($("accountantKnjige")), otherKnjige: num($("otherKnjige")), vatKnjige: $("vatKnjige").checked,
        dirGross: num($("dirGross")), accountantDoo: num($("accountantDoo")), otherDoo: num($("otherDoo")), vatDoo: $("vatDoo").checked,
        vatExtra: num($("vatExtra")), insuredElsewhere: $("insuredElsewhere").checked
      };
    }

    // Fiksna ATM naknada ide u provizije: preračunata kao dodatni % na iznos.
    function runForm(form, monthlyRsd, o) {
      var oo = Object.assign({}, o);
      if (o.atmFee && monthlyRsd > 0) oo.feePct = o.feePct + o.atmFee / monthlyRsd * 100;
      return FORMS[form](monthlyRsd, oo);
    }

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
      var c = runForm(mode, monthlyRsd, opts());
      return { res: c, rows: [["Ostaje ti (neto)", c.net, true]].concat(c.rows) };
    }

    function compareHtml(monthlyRsd, other, ro, mode) {
      var o = opts();
      var res = CONTR.map(function (f) { return runForm(f, monthlyRsd, o); });
      var valid = res.filter(function (r) { return !(r.form === "pausal" && r.annualTurnover > P.pausalLimit); });
      var best = valid.reduce(function (a, b) { return !a || b.net > a.net ? b : a; }, null);
      var rows = res.map(function (r) {
        var over = r.form === "pausal" && r.annualTurnover > P.pausalLimit;
        var cost = r.gross > 0 ? Math.round((1 - r.net / r.gross) * 100) : 0;
        var cls = (r.form === mode ? "cmp-on " : "") + (best && r.form === best.form ? "cmp-best" : "") + (over ? " calc-void" : "");
        var tag = over ? "preko limita" : best && r.form === best.form ? "najviše ostaje" : r.form === "frilenser" ? "model " + r.model : "";
        return '<tr class="' + cls + '"><td><button type="button" class="cmp-pick" data-form="' + r.form + '">' + FORM_LABEL[r.form] + "</button>" + (tag ? ' <span class="cmp-tag">' + tag + "</span>" : "") + "</td>" +
          '<td class="mono">' + fmt(r.net, "RSD") + '</td><td class="mono">' + fmt(r.net / ro, other) + '</td><td class="mono faint">' + cost + "%</td></tr>";
      });
      return '<div class="cmp"><div class="cmp-h">Poređenje za isti iznos: koliko ti ostaje mesečno</div><div class="table-wrap"><table class="compact calc-out"><thead><tr><th>Oblik</th><th>Ostaje RSD</th><th>Ostaje ' + other + "</th><th>Odlazi</th></tr></thead><tbody>" + rows.join("") + "</tbody></table></div></div>";
    }

    function render() {
      KEYS.forEach(function (k) { if ($(k)) st[k] = num($(k)); });
      CHECKS.forEach(function (k) { if ($(k)) st[k] = $(k).checked; });
      st.channel = $("channel").value;
      save(st);

      var mode = form.querySelector('input[name="mode"]:checked').value;
      var cur = $("currency").value;
      var period = $("period").value;
      var kind = $("kind").value;
      var hours = num($("hours")) || 40;
      var contr = mode !== "emp";

      $("hoursWrap").hidden = period !== "hour" && !(offer && offer.period === "hour");
      $("kindWrap").hidden = contr;
      $("contrOpts").hidden = !contr;
      CONTR.forEach(function (f) { var el = $("opt-" + f); if (el) el.hidden = mode !== f; });
      var ch = CHANNELS[st.channel] || CHANNELS.bank;
      $("atmWrap").hidden = !ch.atm;
      $("channelNote").textContent = ch.note;
      $("vatExtraWrap").hidden = !((mode === "knjige" && $("vatKnjige").checked) || (mode === "doo" && $("vatDoo").checked));

      var notes = [];
      var offerMonthly = 0, offerKind = "gross1", offerMin = 0;
      if (offer) {
        var basis = offer.max || offer.min;
        offerKind = offer.kind === "net" ? "net" : "gross1";
        offerMonthly = toMonthly(basis, offer.period, hours) * rate(offer.currency);
        offerMin = offer.min && offer.min !== basis ? toMonthly(offer.min, offer.period, hours) * rate(offer.currency) : 0;
        if (!manualAmount) {
          var target = offerMonthly * (1 + (num($("markup")) || 0) / 100);
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
      var skip = function (r, t) { return !r[2] && !r[1] && (!t || !t[1]); };

      if (offer) {
        var theirs = rowsFor(mode, offerMonthly, offerKind);
        $("calcHead").innerHTML = "<tr><th>Mesečno</th><th>Oglas RSD</th><th>Oglas " + other + "</th><th>Tvoja ponuda RSD</th><th>Tvoja ponuda " + other + "</th><th>Razlika</th></tr>";
        mine.rows.forEach(function (r, i) {
          var t = theirs.rows[i];
          if (skip(r, t)) return;
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
        mine.rows.forEach(function (r) {
          if (skip(r)) return;
          html.push("<tr" + (r[2] ? ' class="calc-strong"' : "") + "><td>" + r[0] + '</td><td class="mono">' + fmt(r[1], "RSD") + '</td><td class="mono">' + fmt(r[1] / ro, other) + '</td><td class="mono faint">' + fmt(r[1] * 12, "RSD") + "</td></tr>");
        });
        if (period !== "month") notes.push("Mesečni iznos: " + fmt(monthly / rate(cur), cur) + (cur !== "RSD" ? " = " + fmt(monthly, "RSD") : "") + (period === "hour" ? " (" + hours + " h nedeljno × 52 / 12)" : " (godišnje / 12)") + ".");
      }

      var res = mine.res;
      if (mode === "emp") {
        if (res.minBaseApplied) notes.push("Bruto je ispod najniže osnovice (" + fmt(P.minBase, "RSD") + "), pa se doprinosi računaju na najnižu osnovicu. Za skraćeno radno vreme ovo nije tačno.");
        if (res.maxBaseApplied) notes.push("Bruto je iznad najviše osnovice (" + fmt(P.maxBase, "RSD") + "), pa doprinosi dalje ne rastu.");
      } else {
        if (mode === "pausal") {
          notes.push("Godišnji promet: " + fmt(res.annualTurnover, "RSD") + " (" + Math.round(res.limitUsage * 100) + "% limita od " + fmt(P.pausalLimit, "RSD") + ").");
          if (res.overLimit) notes.unshift("!Ovaj iznos je iznad limita za paušal (" + fmt(P.pausalLimit, "RSD") + " godišnje), pa red „Ostaje ti“ ne važi: preko limita prelaziš na knjige ili DOO. Paušal radi do ≈ " + fmt(P.pausalLimit / 12 / ro, other) + " mesečno.");
        }
        if (mode === "knjige") notes.push("Lična zarada je trošak firme; ostatak dobiti se oporezuje 10% i posle toga ga podižeš bez dodatnog poreza.");
        if (mode === "doo") notes.push("Dividenda se isplaćuje iz utvrđene dobiti, po odluci skupštine (najčešće posle godišnjeg obračuna), pa ovaj iznos nije svakog meseca na računu.");
        if (mode === "frilenser") notes.push("Prijava i plaćanje kvartalno preko portala Frilenseri; računato po povoljnijem modelu (" + res.model + "). Isplata preko Payoneera, PayPala ili Wise-a ne menja poresku obavezu: prihod rezidenta Srbije se prijavljuje i kad novac ostane na računu u inostranstvu ili se podiže na bankomatu.");
        if ((mode === "knjige" || mode === "doo") && (mode === "knjige" ? $("vatKnjige").checked : $("vatDoo").checked)) notes.push("PDV: za usluge stranoj firmi mesto prometa je u inostranstvu, pa na fakturu ne ide PDV i taj promet se ne računa u limit od 8 miliona. Ulazak u PDV ti ovde donosi uglavnom skuplju knjigovodstvenu uslugu.");
        if (res.profit != null && res.profit < 0) notes.unshift("!Troškovi firme i plata su veći od prihoda: firma posluje sa gubitkom od " + fmt(-res.profit, "RSD") + " mesečno.");
      }
      var at = mode === "emp" || mode === "knjige" || mode === "frilenser" ? annualTax(res.net) : 0;
      if (at > 0) notes.push("Godišnji porez na dohodak (plaćaš sam, do 15. maja): procena ≈ " + fmt(at, "RSD") + " godišnje, tj. ≈ " + fmt(at / 12, "RSD") + " mesečno manje od neta u tabeli. Bez olakšice za mlađe od 40 i za izdržavane članove; prag je za 2025.");

      $("calcOut").innerHTML = html.join("");
      var strong = $("calcOut").querySelector(".calc-strong");
      if (strong) strong.classList.toggle("calc-void", mode === "pausal" && !!res.overLimit);
      $("calcCompare").innerHTML = contr ? compareHtml(monthly, other, ro, mode) : "";
      $("calcNotes").innerHTML = notes.map(function (n) { return n.charAt(0) === "!" ? '<li class="calc-warn">' + esc(n.slice(1)) + "</li>" : "<li>" + esc(n) + "</li>"; }).join("");
    }

    $("amount").addEventListener("input", function () { manualAmount = true; });
    if ($("markup")) $("markup").addEventListener("input", function () { manualAmount = false; });
    $("channel").addEventListener("change", function () { var ch = CHANNELS[$("channel").value]; if (ch) $("channelPct").value = ch.pct; });
    form.addEventListener("input", render);
    form.addEventListener("change", function (e) {
      if (e.target && (e.target.id === "currency" || e.target.id === "period" || e.target.id === "kind" || e.target.name === "mode")) manualAmount = false;
      render();
    });
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest(".cmp-pick");
      if (!b) return;
      var r = form.querySelector('input[name="mode"][value="' + b.getAttribute("data-form") + '"]');
      if (r) { r.checked = true; render(); }
    });
    $("resetRates").addEventListener("click", function () { setRates(); manualAmount = false; render(); });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(typeof window !== "undefined" ? window : this);
