// Replaces the old NameGen PWA worker on clients that still have it installed.
// Unregister without forcing a reload or touching saved names/drafts.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('workbox-precache-') && key.endsWith(self.registration.scope))
      .map((key) => caches.delete(key)));
    await self.registration.unregister();
    await self.clients.claim();
  })());
});

