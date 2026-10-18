// Funciones puras de formato (sin DOM), separadas para poder testearlas.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "hace un momento", "hace 5 min", "hace 2 h 14 min", "hace 3 d 4 h" */
export function formatRelative(timestamp, now = Date.now()) {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE) return 'hace un momento';
  if (diff < HOUR) return `hace ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    const min = Math.floor((diff % HOUR) / MINUTE);
    return min ? `hace ${h} h ${min} min` : `hace ${h} h`;
  }
  const d = Math.floor(diff / DAY);
  const h = Math.floor((diff % DAY) / HOUR);
  return h ? `hace ${d} d ${h} h` : `hace ${d} d`;
}

const dateTimeFormatter = new Intl.DateTimeFormat('es-ES', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});
/** "sáb, 18 oct, 19:30" */
export function formatDateTime(timestamp) {
  return dateTimeFormatter.format(timestamp);
}

/** "350 m", "1,2 km", "15 km" */
export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km.toLocaleString('es-ES', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

/** "512 B", "1,5 MB" */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('es-ES', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

/** plural(1, 'archivo', 'archivos') → "1 archivo"; plural(3, …) → "3 archivos" */
export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function formatCoords({ lat, lng }) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

const LOCATION_ERROR_TEXT = {
  denied: 'permiso de ubicación denegado',
  timeout: 'el GPS no respondió a tiempo',
  unavailable: 'sin señal de GPS',
  unsupported: 'este navegador no tiene GPS',
  skipped: 'guardado sin esperar al GPS',
};
export function describeLocationError(code) {
  return LOCATION_ERROR_TEXT[code] ?? 'ubicación no disponible';
}

/** Texto corto que describe dónde está el coche: nota, dirección o coordenadas. */
export function describePlace(record) {
  const parts = [];
  if (record.note) parts.push(record.note);
  if (record.address) parts.push(record.address);
  else if (record.location && !record.note) parts.push(formatCoords(record.location));
  return parts.join(' · ');
}
