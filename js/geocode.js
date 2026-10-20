// Geocodificación inversa (coordenadas → «Carrer Major 12, Tarragona») con Nominatim, el
// servicio gratuito de OpenStreetMap. Va en su propio módulo porque es el único que habla
// con un servidor externo, y así su política de uso queda en un solo sitio:
//   - como mucho 1 petición por segundo (aquí, una cola con 1,1 s entre peticiones),
//   - nunca repetir la misma petición (el resultado se guarda en el registro),
//   - nada de peticiones masivas (app.js solo pide los registros pendientes más recientes).
// El navegador envía el Referer de la app, que es la identificación que pide Nominatim a las webs.
// Antes de preguntar, se mira si ya aparcaste a pocos metros (casa, trabajo…): así ni se gasta
// una petición ni hace falta conexión.

import { distanceMeters, POOR_ACCURACY_M } from './location.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const MIN_INTERVAL_MS = 1100;
export const NEARBY_ADDRESS_M = 25;

/**
 * Calle de un aparcamiento anterior a menos de 25 m del punto, o null si no hay ninguno.
 * Solo se fía de registros con buena precisión, y si hay varios coge el más cercano.
 */
export function findNearbyAddress(location, records, maxDistance = NEARBY_ADDRESS_M) {
  let best = null;
  let bestDistance = maxDistance;
  for (const record of records) {
    if (!record.address || !record.location || record.location.accuracy > POOR_ACCURACY_M) continue;
    const distance = distanceMeters(location, record.location);
    if (distance <= bestDistance) {
      best = record.address;
      bestDistance = distance;
    }
  }
  return best;
}

let lastRequestAt = 0;
let queue = Promise.resolve();

/** Monta una dirección corta a partir de la respuesta de Nominatim ('' si no hay nada útil). */
export function buildAddress(json) {
  const a = json?.address;
  if (!a) return '';
  const street = a.road ?? a.pedestrian ?? a.footway ?? a.square ?? a.neighbourhood ?? a.suburb ?? '';
  const streetWithNumber = street && a.house_number ? `${street} ${a.house_number}` : street;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? '';
  return [streetWithNumber, city].filter(Boolean).join(', ');
}

/**
 * @returns {Promise<string>} la dirección, o '' si Nominatim no encuentra nada.
 *   Se rechaza si falla la red (para reintentarlo más tarde).
 */
export function reverseGeocode({ lat, lng }) {
  const task = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();

    const params = new URLSearchParams({
      format: 'jsonv2', lat, lon: lng, zoom: 18, addressdetails: 1, 'accept-language': 'es',
    });
    const response = await fetch(`${ENDPOINT}?${params}`);
    if (!response.ok) throw new Error(`Nominatim respondió ${response.status}`);
    return buildAddress(await response.json());
  });
  queue = task.catch(() => {}); // un fallo no debe bloquear las peticiones siguientes
  return task;
}
