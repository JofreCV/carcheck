// Service Worker: hace que la app abra sin conexión.
// - App shell (HTML, CSS, JS, Leaflet, iconos): cache-first. Se descarga entero al instalar
//   y se sirve siempre desde la caché, así abre al instante aunque no haya cobertura.
// - Teselas del mapa: network-first. Si hay red se usan frescas y se guarda una copia; sin red
//   se tira de las últimas vistas. No se descargan zonas por adelantado (política de uso de OSM).

// IMPORTANTE: subir este número en cada cambio de cualquier archivo del app shell;
// si no, los móviles que ya tienen la app seguirán usando la versión antigua.
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `carcheck-shell-${CACHE_VERSION}`;
const TILE_CACHE = 'carcheck-tiles';
const MAX_TILES = 300;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/ui.js',
  './js/format.js',
  './js/model.js',
  './js/storage.js',
  './js/location.js',
  './js/media.js',
  './js/map.js',
  './js/geocode.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet-src.esm.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      // Activar la versión nueva sin esperar a que se cierren todas las pestañas.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('carcheck-shell-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(networkFirstTile(request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
});

// Al tocar una notificación (aviso del ticket), abrir la app o traerla al frente.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) =>
      windows.length ? windows[0].focus() : self.clients.openWindow('./')),
  );
});

async function cacheFirst(request) {
  // En las navegaciones se ignora la query (?view=map de los accesos directos) para
  // que siempre encuentre el index.html cacheado.
  const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (error) {
    if (request.mode === 'navigate') return caches.match('./index.html');
    throw error;
  }
}

async function networkFirstTile(request) {
  const cache = await caches.open(TILE_CACHE);
  try {
    const response = await fetch(request);
    // Solo respuestas CORS (Leaflet pide las teselas con crossOrigin): las opacas
    // ocuparían muchísimo en la cuota de almacenamiento de Chrome.
    if (response.ok && response.type === 'cors') {
      await cache.put(request, response.clone());
      trimCache(cache, MAX_TILES);
    }
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}

/** Borra las entradas más antiguas para que la caché de teselas no crezca sin límite. */
async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - maxEntries))) {
    await cache.delete(key);
  }
}
