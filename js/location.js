// Geolocalización. La primera lectura del GPS suele ser imprecisa (viene de wifi o de antenas),
// así que en lugar de un único getCurrentPosition escuchamos varias lecturas y nos quedamos
// con la mejor hasta que sea suficientemente buena o se acabe el tiempo.

export const GOOD_ACCURACY_M = 20;  // con esto ya paramos de buscar
export const POOR_ACCURACY_M = 50;  // por encima avisamos al usuario
const MAX_WAIT_MS = 20000;
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

export class LocationError extends Error {
  /** @param {'denied'|'timeout'|'unavailable'|'unsupported'} code */
  constructor(code) {
    super(code);
    this.name = 'LocationError';
    this.code = code;
  }
}

function toFix(position) {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy),
    capturedAt: position.timestamp,
    source: 'gps',
  };
}

function toLocationError(geoError) {
  if (geoError.code === geoError.PERMISSION_DENIED) return new LocationError('denied');
  if (geoError.code === geoError.TIMEOUT) return new LocationError('timeout');
  return new LocationError('unavailable');
}

/**
 * Empieza a buscar la posición más precisa posible.
 * @param {{ onUpdate?: (fix) => void }} options  onUpdate se llama cada vez que mejora la precisión
 * @returns {{ promise: Promise<fix>, stop: () => void }}
 *   promise se resuelve con la mejor lectura, o se rechaza con LocationError si no hubo ninguna.
 *   stop() termina la búsqueda ya, quedándose con lo que haya.
 */
export function acquireBestPosition({ onUpdate, maxWaitMs = MAX_WAIT_MS, targetAccuracy = GOOD_ACCURACY_M } = {}) {
  let finish = () => {};

  const promise = new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationError('unsupported'));
      return;
    }

    let best = null;
    let lastError = null;
    let finished = false;

    finish = (error) => {
      if (finished) return;
      finished = true;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(error ?? lastError ?? new LocationError('timeout'));
    };

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const fix = toFix(position);
        if (!best || fix.accuracy < best.accuracy) {
          best = fix;
          onUpdate?.(best);
        }
        if (best.accuracy <= targetAccuracy) finish();
      },
      (geoError) => {
        lastError = toLocationError(geoError);
        // Un permiso denegado no se va a arreglar esperando; el resto de errores pueden ser
        // momentáneos (sin señal dentro de un parking), así que seguimos hasta el tiempo límite.
        if (lastError.code === 'denied') finish(lastError);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );
    const timer = setTimeout(() => finish(), maxWaitMs);
  });

  return { promise, stop: () => finish() };
}

/**
 * Última posición que conoce el navegador (de hasta hace 10 min) o, si no tiene ninguna,
 * una rápida por wifi/antenas. Sirve de plan B en parkings subterráneos, donde el GPS no
 * llega pero hace un minuto, al entrar, sí había señal.
 */
export function getLastKnownPosition() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new LocationError('unsupported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ ...toFix(position), source: 'lastKnown' }),
      (geoError) => reject(toLocationError(geoError)),
      { enableHighAccuracy: false, maximumAge: LAST_KNOWN_MAX_AGE_MS, timeout: 3000 },
    );
  });
}

/**
 * Sigue la posición del usuario de forma continua (para el mapa).
 * @returns {() => void} función para dejar de escuchar (ahorra batería)
 */
export function watchCurrentPosition(onFix, onError) {
  if (!('geolocation' in navigator)) {
    onError?.(new LocationError('unsupported'));
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (position) => onFix(toFix(position)),
    (geoError) => onError?.(toLocationError(geoError)),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** Distancia en metros entre dos puntos {lat, lng} (fórmula del haversine). */
export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
