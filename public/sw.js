// Jobseeker service worker: push notifications only (no offline cache).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let n = { title: 'Jobseeker', body: '', url: '/' };
  try {
    n = Object.assign(n, event.data ? event.data.json() : {});
  } catch (e) {
    if (event.data) n.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(n.title, {
      body: n.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: n.tag || undefined,
      data: { url: n.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c) {
          if ('navigate' in c) await c.navigate(url).catch(() => null);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
