(function () {
  'use strict';

  // ---- Feedback messages: tell assistive tech about them, let the user dismiss them, fade the success ones.
  function setupFlashes() {
    document.querySelectorAll('.flash').forEach(function (f) {
      if (!f.getAttribute('role')) f.setAttribute('role', f.classList.contains('err') ? 'alert' : 'status');
    });
    document.querySelectorAll('.flash[data-autodismiss]').forEach(function (f) {
      function close() {
        f.classList.add('leaving');
        setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 320);
      }
      var x = f.querySelector('.flash-x');
      if (x) x.addEventListener('click', close);
      setTimeout(close, 6000);
    });
    // Drop the one-shot ?ok= / ?view_saved= from the address bar so a refresh does not repeat the message.
    try {
      var u = new URL(location.href);
      var changed = false;
      ['ok', 'view_saved'].forEach(function (k) {
        if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; }
      });
      if (changed) history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    } catch (e) { /* older browsers: harmless */ }
  }

  // ---- Saved views: save what is on screen right now (live search changes the URL without a reload).
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList || !form.classList.contains('view-save')) return;
    var hidden = form.querySelector('input[name="query"]');
    if (!hidden) return;
    var u = new URL(location.href);
    u.searchParams.delete('view_saved');
    u.searchParams.delete('ok');
    var qs = u.searchParams.toString();
    if (qs && u.pathname === '/jobs') hidden.value = qs;
  });

  // ---- Keyboard shortcuts
  var NAV = {
    d: ['/', 'Pregled'],
    j: ['/jobs', 'Poslovi'],
    b: ['/jobs?view=board', 'Tabla'],
    x: ['/excluded', 'Izbačeni'],
    a: ['/agent', 'Agent'],
    p: ['/profile', 'Profil i kriterijumi']
  };

  function typing(t) {
    if (!t || !t.tagName) return false;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function focusSearch() {
    var el = document.querySelector('input[name="q"]');
    if (!el) return false;
    el.focus();
    if (el.select) el.select();
    return true;
  }

  var dialog = null;
  function helpDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'kbd-help';
    dialog.setAttribute('aria-label', 'Prečice');
    var rows = [
      ['<kbd>/</kbd>', 'Pretraga'],
      ['<kbd>n</kbd>', 'Novi posao'],
      ['<kbd>?</kbd>', 'Prikaži ili sakrij ovu listu'],
      ['<kbd>Esc</kbd>', 'Zatvori listu ili izađi iz pretrage']
    ];
    Object.keys(NAV).forEach(function (k) {
      rows.push(['<kbd>g</kbd> then <kbd>' + k + '</kbd>', 'Idi na ' + NAV[k][1]]);
    });
    dialog.innerHTML =
      '<h2>Prečice</h2><dl>' +
      rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') +
      '</dl><button type="button" class="btn btn-line btn-sm" data-close>Zatvori</button>';
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog || (e.target.closest && e.target.closest('[data-close]'))) closeHelp();
    });
    document.body.appendChild(dialog);
    return dialog;
  }
  function openHelp() {
    var d = helpDialog();
    if (d.open) return;
    if (d.showModal) d.showModal();
    else d.setAttribute('open', '');
  }
  function closeHelp() {
    if (!dialog || !dialog.open) return;
    if (dialog.close) dialog.close();
    else dialog.removeAttribute('open');
  }

  var pendingG = false;
  var gTimer = null;
  function clearG() {
    pendingG = false;
    clearTimeout(gTimer);
  }

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (dialog && dialog.open) return; // the dialog closes itself
      if (typing(e.target) && e.target.blur) e.target.blur();
      clearG();
      return;
    }
    if (typing(e.target)) return;
    var k = e.key;

    if (pendingG) {
      clearG();
      var hit = NAV[k.toLowerCase()];
      if (hit) {
        e.preventDefault();
        location.href = hit[0];
      }
      return;
    }
    if (k === '/') {
      e.preventDefault();
      if (!focusSearch()) location.href = '/jobs#search';
    } else if (k === '?') {
      e.preventDefault();
      if (dialog && dialog.open) closeHelp();
      else openHelp();
    } else if (k === 'g') {
      pendingG = true;
      gTimer = setTimeout(clearG, 1200);
    } else if (k === 'n') {
      e.preventDefault();
      location.href = '/jobs/new';
    }
  });

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-kbd-help]')) openHelp();
  });

  // The lead card's action bar shows the lead's name only once it is stuck to the top (the heading is out of view then).
  function setupActionBar() {
    var bar = document.querySelector('.action-bar');
    if (!bar) return;
    function check() {
      bar.classList.toggle('stuck', bar.getBoundingClientRect().top <= 62);
    }
    window.addEventListener('scroll', check, { passive: true });
    check();
  }

  function init() {
    setupFlashes();
    setupActionBar();
    if (location.hash === '#search') {
      focusSearch();
      history.replaceState(null, '', location.pathname + location.search);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
