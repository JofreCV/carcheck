// Teselas del mapa alrededor del coche, descargadas al aparcar, para que el mapa funcione
// aunque vuelvas sin cobertura o sin roaming. No usa Leaflet (solo matemáticas de teselas),
// así se puede llamar al guardar sin cargar el mapa.
//
// Política de uso de OpenStreetMap: está prohibido descargar zonas grandes por adelantado
// (más de 250 teselas a zoom ≥ 13). Aquí se bajan 19 por aparcamiento y en serie.

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const PARKING_CACHE = 'carcheck-tiles-parking';

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

/**
 * Descarga la zona del coche: la tesela central a zoom 15 (vista general) y 3×3 a zoom 16 y 17
 * (unos 1,5 km alrededor a nivel de calle). Sustituye la zona del aparcamiento anterior.
 * @returns {Promise<number>} cuántas teselas se han guardado
 */
export async function prefetchParkingTiles({ lat, lng }) {
  if (!('caches' in window) || navigator.connection?.saveData) return 0;
  const tiles = [...tilesAround(lat, lng, 15, 0), ...tilesAround(lat, lng, 16, 1), ...tilesAround(lat, lng, 17, 1)];

  await caches.delete(PARKING_CACHE);
  const cache = await caches.open(PARKING_CACHE);
  let saved = 0;
  for (const tile of tiles) { // una a una, para no cargar el servidor de OSM
    const url = tileUrl(tile);
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.ok) {
        await cache.put(url, response);
        saved++;
      }
    } catch {
      break; // sin conexión: no tiene sentido seguir intentándolo
    }
  }
  return saved;
}
