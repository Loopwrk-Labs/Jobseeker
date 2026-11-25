// Registers the service worker and wires the "Notifikacije" panel, if present.
(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(function () {});

  var box = document.getElementById('pushBox');
  if (!box) return;
  var btn = document.getElementById('pushBtn');
  var testBtn = document.getElementById('pushTest');
  var msg = document.getElementById('pushMsg');
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  function say(t) { msg.textContent = t; }
  function b64ToU8(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var r = atob(s), a = new Uint8Array(r.length);
    for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i);
    return a;
  }

  if (!('PushManager' in window) || !('Notification' in window)) {
    btn.disabled = true;
    say(ios && !standalone
      ? 'Na iPhone-u: otvori Jobseeker u Safariju → Share → Add to Home Screen, pa uključi notifikacije iz aplikacije sa početnog ekrana.'
      : 'Ovaj browser ne podržava push notifikacije.');
    return;
  }

  async function state() {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    btn.textContent = sub ? 'Isključi na ovom uređaju' : 'Uključi notifikacije na ovom uređaju';
    testBtn.hidden = !sub;
    if (Notification.permission === 'denied') say('Notifikacije su blokirane u podešavanjima browsera ili telefona.');
    return sub;
  }

  btn.addEventListener('click', async function () {
    btn.disabled = true;
    try {
      var reg = await navigator.serviceWorker.ready;
      var sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
        say('Isključeno na ovom uređaju.');
      } else {
        var perm = await Notification.requestPermission();
        if (perm !== 'granted') { say('Dozvola nije data.'); return; }
        var key = (await (await fetch('/push/key')).json()).publicKey;
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
        var j = sub.toJSON();
        j.label = (ios ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Android' : 'Računar') + ' · ' + new Date().toLocaleDateString('sr-RS');
        await fetch('/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(j) });
        say('Uključeno. Pošalji probnu notifikaciju da proveriš.');
      }
    } catch (e) {
      say('Nije uspelo: ' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
      state();
    }
  });

  testBtn.addEventListener('click', async function () {
    var r = await (await fetch('/push/test', { method: 'POST' })).json();
    say(r.sent ? 'Poslato. Stiže za par sekundi.' : 'Nije poslato (' + (r.failed || 0) + ' grešaka).');
  });

  state();
})();
