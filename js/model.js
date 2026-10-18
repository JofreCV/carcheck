// Modelo de datos de un registro de cierre.
// Está versionado para poder añadir campos sin romper los registros que ya hay en el móvil:
// cada lectura pasa por migrateRecord(), que actualiza los registros antiguos al formato actual.

export const SCHEMA_VERSION = 1;
export const DEFAULT_VEHICLE_ID = 'default';
export const DEFAULT_MEDIA_RETENTION = 10;

// Valores por defecto de cada campo. Si un registro antiguo no tiene alguno, se rellena con esto.
const RECORD_DEFAULTS = {
  vehicleId: DEFAULT_VEHICLE_ID,
  locked: true,
  location: null,       // { lat, lng, accuracy, capturedAt }
  locationError: null,  // 'denied' | 'timeout' | 'unavailable' | 'unsupported'
  address: null,        // reservado para la geocodificación inversa
  note: '',
  media: null,          // ver createMediaInfo()
};

// Pasos de migración: la clave es la versión de origen.
// Ejemplo para el futuro: 1: (r) => ({ ...r, ticketExpiresAt: null, schemaVersion: 2 }),
const MIGRATIONS = {};

export function createRecord({ location = null, locationError = null, note = '', media = null, now = Date.now() } = {}) {
  return {
    ...RECORD_DEFAULTS,
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    createdAt: now,
    location,
    locationError: location ? null : locationError,
    note: note.trim(),
    media,
  };
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
