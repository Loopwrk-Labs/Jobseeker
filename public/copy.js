(function () {
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy]');
    if (!b) return;
    var el = document.getElementById(b.getAttribute('data-copy'));
    if (!el) return;
    var done = function () { var t = b.textContent; b.textContent = 'Kopirano'; setTimeout(function () { b.textContent = t; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(done, function () { el.select(); document.execCommand('copy'); done(); });
    else { el.select(); document.execCommand('copy'); done(); }
  });
})();
(function () {
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-copy-text]');
    if (!b) return;
    var t = b.getAttribute('data-copy-text');
    var done = function () { var o = b.textContent; b.textContent = 'Kopirano'; setTimeout(function () { b.textContent = o; }, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(done);
  });
})();
