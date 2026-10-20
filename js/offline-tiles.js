// Teselas del mapa alrededor del coche, descargadas al aparcar, para que el mapa funcione
// aunque vuelvas sin cobertura o sin roaming. No usa Leaflet (solo matemáticas de teselas),
// así se puede llamar al guardar sin cargar el mapa.
//
// Política de uso de OpenStreetMap: está prohibido descargar zonas grandes por adelantado
// (más de 250 teselas a zoom ≥ 13). Aquí se bajan como mucho 19 por aparcamiento y en serie.

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const PARKING_CACHE = 'carcheck-tiles-parking';
const FETCHED_AT_HEADER = 'x-carcheck-fetched-at';
const TILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // lo que OSM permite seguir usando una tesela (stale-while-revalidate)
const MAX_PARKING_TILES = 120; // unas 6 zonas de aparcamiento (~2 MB)

/** Tesela (x, y) que contiene un punto a un zoom dado (proyección Web Mercator). */
export function tileFor(lat, lng, zoom) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    z: zoom,
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n),
  };
}

/** La tesela del punto y las que la rodean: radius 1 → cuadrado de 3×3. */
export function tilesAround(lat, lng, zoom, radius) {
  const center = tileFor(lat, lng, zoom);
  const tiles = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      tiles.push({ z: zoom, x: center.x + dx, y: center.y + dy });
    }
  }
  return tiles;
}

export function tileUrl({ z, x, y }) {
  return TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

/** Copia de la tesela con la hora de descarga (las cabeceras de OSM no lo dicen de forma fiable). */
async function stamp(response, now = Date.now()) {
  return new Response(await response.blob(), {
    headers: { 'content-type': response.headers.get('content-type') ?? 'image/png', [FETCHED_AT_HEADER]: String(now) },
  });
}

/** ¿La tesela guardada se descargó hace menos de 7 días? */
export function isTileRecent(response, now = Date.now()) {
  const fetchedAt = Number(response.headers.get(FETCHED_AT_HEADER));
  return fetchedAt > 0 && now - fetchedAt < TILE_MAX_AGE_MS;
}

/**
 * Descarga la zona del coche: la tesela central a zoom 15 (vista general) y 3×3 a zoom 16 y 17
 * (unos 1,5 km alrededor a nivel de calle).
 * Se guardan las zonas de los últimos aparcamientos durante 7 días: si vuelves a aparcar en un
 * sitio habitual (casa, trabajo…), las teselas que ya tienes no se vuelven a pedir a OSM.
 * @returns {Promise<number>} cuántas teselas de la zona quedan guardadas
 */
export async function prefetchParkingTiles({ lat, lng }) {
  if (!('caches' in window) || navigator.connection?.saveData) return 0;
  const tiles = [...tilesAround(lat, lng, 15, 0), ...tilesAround(lat, lng, 16, 1), ...tilesAround(lat, lng, 17, 1)];
  const urls = tiles.map(tileUrl);

  const cache = await caches.open(PARKING_CACHE);
  let saved = 0;
  for (const url of urls) { // una a una, para no cargar el servidor de OSM
    const cached = await cache.match(url);
    if (cached && isTileRecent(cached)) {
      saved++;
      continue;
    }
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) {
        await cache.put(url, await stamp(response));
        saved++;
      }
    } catch {
      break; // sin conexión: no tiene sentido seguir intentándolo
    }
  }
  await pruneParkingTiles(cache, urls);
  return saved;
}

/** Borra las teselas de más de 7 días y, si aún sobran, las más antiguas (nunca las de la zona actual). */
async function pruneParkingTiles(cache, keepUrls) {
  const entries = [];
  for (const request of await cache.keys()) {
    if (keepUrls.includes(request.url)) continue;
    const response = await cache.match(request);
    if (!isTileRecent(response)) await cache.delete(request);
    else entries.push({ request, fetchedAt: Number(response.headers.get(FETCHED_AT_HEADER)) });
  }
  entries.sort((a, b) => a.fetchedAt - b.fetchedAt);
  const excess = entries.length + keepUrls.length - MAX_PARKING_TILES;
  for (const { request } of entries.slice(0, Math.max(0, excess))) await cache.delete(request);
}
