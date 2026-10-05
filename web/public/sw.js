/**
 * Service worker minimal : il rend l'app installable et sert une coquille
 * lisible hors ligne. Les données de prix ne sont jamais mises en cache —
 * un prix périmé serait pire qu'un écran de chargement.
 */
const SHELL_CACHE = 'bon-tracker-shell-v2';
const SHELL_ASSETS = ['/icons/icon-192.png', '/icons/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((hit) => hit || new Response('Hors ligne', { status: 503 })),
    ),
  );
});

/**
 * Notification d'une veille : le serveur envoie titre, texte et page à ouvrir.
 * Une notification sans contenu lisible s'affiche quand même — iOS retire
 * l'autorisation à une app qui reçoit un envoi sans rien montrer.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Bon Tracker';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      image: data.image || undefined,
      data: { url: data.url || '/alertes' },
    }),
  );
});

/** Toucher la notification ouvre la page visée, en réutilisant l'app déjà ouverte. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/alertes', self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && 'focus' in client) {
          client.navigate(target.href);
          return client.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
