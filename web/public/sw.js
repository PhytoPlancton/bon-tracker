/**
 * Service worker minimal : il rend l'app installable et sert une coquille
 * lisible hors ligne. Les données de prix ne sont jamais mises en cache —
 * un prix périmé serait pire qu'un écran de chargement.
 */
const SHELL_CACHE = 'bon-tracker-shell-v1';
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
