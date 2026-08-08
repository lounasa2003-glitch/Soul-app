// Service worker minimo, solo para cumplir el requisito de instalabilidad
// de PWA -- Soul es una app de datos en vivo (chat, matches, citas), asi
// que la estrategia es "red primero, cache solo como respaldo sin
// conexion", nunca "cache primero". Nunca toca /api/* -- cachear eso
// mostraria datos viejos como si fueran actuales (un match que ya no esta,
// un mensaje que ya se respondio).
// v2: se agrega index.html -- desde que start_url (manifest.json y
// capacitor.config.json) pasaron a apuntar ahi en vez de a soul.html
// directo, esta lista se habia quedado vieja: si la red fallaba o tardaba
// justo en el arranque, no habia nada cacheado como respaldo para
// index.html y la app quedaba en blanco (reportado en vivo el 2026-08-08).
// El nombre de cache nuevo fuerza que activate() reemplace el cache viejo
// (que nunca tuvo index.html) en vez de reusarlo tal cual.
const CACHE_NAME = 'soul-shell-v2';
const APP_SHELL = ['/soul.html', '/index.html', '/manifest.json'];

// Push en el navegador (gente que usa Soul desde Chrome sin instalar la
// app) -- mismo proyecto de Firebase que la app Android, mismo endpoint de
// envio del lado del servidor (lib/push.js le manda a cualquier token sin
// importar la plataforma). Se importa el SDK "compat" via importScripts
// porque un service worker clasico (no type=module) no puede usar import
// estatico -- es el patron que documenta la propia Firebase para esto.
// Si Firebase no llega a cargar (sin red, bloqueado, etc.) el resto del
// service worker (cache/fetch de arriba) sigue funcionando igual, por eso
// va en un try/catch aparte.
try {
  importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.13.1/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyCnL4QNw51zccaM5hredj3oezAAtPkPXZ4',
    authDomain: 'soulapp-2d92e.firebaseapp.com',
    projectId: 'soulapp-2d92e',
    storageBucket: 'soulapp-2d92e.firebasestorage.app',
    messagingSenderId: '586817950812',
    appId: '1:586817950812:web:502edf98783e3b32c54299'
  });
  // Con esto inicializado, Firebase ya muestra sola la notificacion cuando
  // llega un push y la pestaña de Soul no esta enfocada -- no hace falta
  // un listener de 'push' a mano ademas de esto.
  firebase.messaging();
} catch (e) {}

// Click en la notificacion (cartel del sistema) -- Firebase la muestra
// sola, pero el click hay que manejarlo a mano: si ya hay una pestaña de
// Soul abierta, la enfoca y le manda el "data" del push para que rutee a
// la pantalla correcta (mismo aplicarDeepLinkPush que usa la app Android,
// ver soul.html); si no hay ninguna, abre una nueva.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data && event.notification.data.FCM_MSG && event.notification.data.FCM_MSG.data) || event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      const existente = lista.find((c) => c.url.includes('/soul.html'));
      if (existente) {
        existente.postMessage({ tipoMensaje: 'push_click', data });
        return existente.focus();
      }
      return self.clients.openWindow('/soul.html');
    })
  );
});

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
