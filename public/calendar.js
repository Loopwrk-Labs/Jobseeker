// Calendar filters: event type and job status chips, remembered in this browser.
(function () {
  var root = document.getElementById('cal');
  if (!root) return;
  var KEY = 'jobseeker.calfilters.v1';
  var DEF = { kind: ['iv', 'fu', 'applied'], status: ['review', 'ready', 'applied', 'interview', 'offer', 'rejected'] };
  var st;
  try { st = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { st = null; }
  if (!st || !st.kind || !st.status) st = JSON.parse(JSON.stringify(DEF));
  var MAX = 4;

  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function on(el) { return st.kind.indexOf(el.dataset.kind) >= 0 && st.status.indexOf(el.dataset.status) >= 0; }

  function apply() {
    root.querySelectorAll('.fchip[data-f]').forEach(function (b) {
      b.setAttribute('aria-pressed', st[b.dataset.f].indexOf(b.dataset.v) >= 0 ? 'true' : 'false');
    });
    root.querySelectorAll('.calx-evs').forEach(function (box) {
      var shown = 0, hidden = 0;
      box.querySelectorAll('.calx-e').forEach(function (e) {
        var ok = on(e);
        if (ok && shown < MAX) { e.hidden = false; shown++; } else { e.hidden = true; if (ok) hidden++; }
      });
      var more = box.querySelector('.calx-x');
      if (more) { more.hidden = !hidden; more.textContent = '+' + hidden + ' još'; }
    });
    root.querySelectorAll('.calx-dots i').forEach(function (d) { d.hidden = !on(d); });
    var any = false;
    root.querySelectorAll('.calx-list li').forEach(function (li) { li.hidden = !on(li); if (!li.hidden) any = true; });
    var empty = document.getElementById('calEmpty');
    if (empty) empty.hidden = any;
  }

  root.addEventListener('click', function (ev) {
    var b = ev.target.closest('.fchip');
    if (!b) return;
    if (b.id === 'calReset') { st = JSON.parse(JSON.stringify(DEF)); }
    else {
      var list = st[b.dataset.f], v = b.dataset.v, i = list.indexOf(v);
      if (ev.altKey || ev.metaKey) { st[b.dataset.f] = [v]; }       // Alt/⌘-click: only this one
      else if (i >= 0) list.splice(i, 1); else list.push(v);
    }
    save(); apply();
  });
  apply();
})();
