// Service worker minimo, solo para cumplir el requisito de instalabilidad
// de PWA -- Soul es una app de datos en vivo (chat, matches, citas), asi
// que la estrategia es "red primero, cache solo como respaldo sin
// conexion", nunca "cache primero". Nunca toca /api/* -- cachear eso
// mostraria datos viejos como si fueran actuales (un match que ya no esta,
// un mensaje que ya se respondio).
const CACHE_NAME = 'soul-shell-v1';
const APP_SHELL = ['/soul.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
