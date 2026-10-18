// Modelo de datos de un registro de cierre.
// Está versionado para poder añadir campos sin romper los registros que ya hay en el móvil:
// cada lectura pasa por migrateRecord(), que actualiza los registros antiguos al formato actual.

export const SCHEMA_VERSION = 2;
export const DEFAULT_VEHICLE_ID = 'default';
export const DEFAULT_MEDIA_RETENTION = 10;

// Valores por defecto de cada campo. Si un registro antiguo no tiene alguno, se rellena con esto.
const RECORD_DEFAULTS = {
  vehicleId: DEFAULT_VEHICLE_ID,
  locked: true,
  location: null,       // { lat, lng, accuracy, capturedAt, source: 'gps' | 'lastKnown' }
  locationError: null,  // 'denied' | 'timeout' | 'unavailable' | 'unsupported' | 'skipped'
  address: null,        // calle (Nominatim): null = pendiente de buscar, '' = sin resultado
  note: '',
  media: null,          // ver createMediaInfo()
  endedAt: null,        // cuándo se recogió el coche (null = sigue aparcado)
  ticketExpiresAt: null, // hasta cuándo vale el ticket de zona azul
};

// Pasos de migración: la clave es la versión de origen. Cada paso devuelve el registro
// en la versión siguiente; migrateRecord los encadena hasta llegar a SCHEMA_VERSION.
const MIGRATIONS = {
  // v1 → v2: estado aparcado/recogido, ticket de zona azul y origen de la ubicación.
  1: (record) => ({
    ...record,
    endedAt: record.endedAt ?? null,
    ticketExpiresAt: record.ticketExpiresAt ?? null,
    location: record.location ? { source: 'gps', ...record.location } : null,
    schemaVersion: 2,
  }),
};

export function createRecord({ location = null, locationError = null, note = '', media = null, ticketExpiresAt = null, now = Date.now() } = {}) {
  return {
    ...RECORD_DEFAULTS,
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    createdAt: now,
    location,
    locationError: location ? null : locationError,
    note: note.trim(),
    media,
    ticketExpiresAt,
  };
}

/** El coche sigue aparcado en este registro (no se ha marcado como recogido). */
export function isParked(record) {
  return Boolean(record) && !record.endedAt;
}

export function createMediaInfo({ type, mimeType, size, width = null, height = null, durationMs = null, thumbnail = null }) {
  return { type, mimeType, size, width, height, durationMs, thumbnail, purged: false };
}

export function migrateRecord(raw) {
  let record = { ...RECORD_DEFAULTS, ...raw, schemaVersion: raw.schemaVersion ?? 1 };
  while (record.schemaVersion < SCHEMA_VERSION) {
    const migrate = MIGRATIONS[record.schemaVersion];
    if (!migrate) throw new Error(`Falta la migración desde la versión ${record.schemaVersion}`);
    record = migrate(record);
  }
  return record;
}

/**
 * Devuelve los registros cuyo archivo multimedia hay que borrar.
 * Se conservan los archivos de los `keep` registros más recientes que tienen multimedia;
 * así nunca hay más de `keep` fotos o vídeos guardados.
 * @param {Array} records ordenados del más reciente al más antiguo
 */
export function selectRecordsToPurge(records, keep) {
  const withMedia = records.filter((r) => r.media && !r.media.purged);
  return withMedia.slice(Math.max(0, keep));
}
