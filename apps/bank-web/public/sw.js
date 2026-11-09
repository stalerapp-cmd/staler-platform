/*
 * Device notifications only. This worker never caches pages or handles requests,
 * so a new deploy always shows up as soon as the page reloads.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const seen = wins.find((w) => w.visibilityState === 'visible' && w.focused);
      // Someone is looking at the app right now: let the page show it (with sound, if on).
      if (seen) {
        seen.postMessage({ kind: 'push', notice: d });
        return;
      }
      for (const w of wins) w.postMessage({ kind: 'push', notice: d, hidden: true });
      const ar = d.lang === 'ar';
      await self.registration.showNotification(d.title || (ar ? 'إشعار جديد' : 'New notification'), {
        body: d.body || '',
        icon: '/icon-192.png',
        badge: '/favicon-48.png',
        tag: d.id || undefined,
        lang: ar ? 'ar' : 'en',
        dir: ar ? 'rtl' : 'ltr',
        timestamp: Date.now(),
        data: { link: d.link || '/app' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/app';
  const url = new URL(link, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          w.postMessage({ kind: 'open', link });
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
