(function () {
  'use strict';

  // Filter dropdowns (<details class="dd">): a click opens one, and moving the mouse away closes it,
  // so no second click is needed. A short delay lets the pointer cross the gap between the button and
  // the menu. Touch devices keep tap to open / tap to close.
  var DELAY = 250;

  document.querySelectorAll('details.dd').forEach(function (dd) {
    var timer = null;

    function cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    dd.addEventListener('pointerenter', function (e) {
      if (e.pointerType === 'mouse') cancel();
    });

    dd.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse' || !dd.open) return;
      // Someone typing inside the menu (for example naming a saved view) must not lose it when the mouse drifts away.
      if (dd.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      cancel();
      timer = setTimeout(function () {
        dd.open = false;
        timer = null;
      }, DELAY);
    });

    // Opening one dropdown closes the others.
    dd.addEventListener('toggle', function () {
      if (!dd.open) return;
      document.querySelectorAll('details.dd[open]').forEach(function (other) {
        if (other !== dd) other.open = false;
      });
    });
  });
})();
