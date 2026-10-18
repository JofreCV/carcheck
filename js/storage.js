// Acceso a IndexedDB con un wrapper mínimo propio (en vez de la librería `idb`):
// solo hacen falta unas pocas operaciones y así no añadimos dependencias.

import { migrateRecord, selectRecordsToPurge, DEFAULT_MEDIA_RETENTION } from './model.js';

const DB_VERSION = 1;
let dbName = 'carcheck';

export const DEFAULT_SETTINGS = { mediaRetention: DEFAULT_MEDIA_RETENTION };

let dbPromise = null;

/** Solo para los tests: usar otra base de datos para no tocar los datos reales. */
export async function useDatabaseForTests(name) {
  // Cerrar la conexión anterior; si no, borrar la base de datos se quedaría bloqueado.
  if (dbPromise) (await dbPromise).close();
  dbName = name;
  dbPromise = null;
}

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      // Sin `break`: un usuario con una versión antigua pasa por todos los pasos hasta la actual.
      switch (event.oldVersion) {
        case 0: {
          const records = db.createObjectStore('records', { keyPath: 'id' });
          records.createIndex('createdAt', 'createdAt');
          // Los archivos grandes van aparte para que listar el historial no cargue vídeos.
          db.createObjectStore('media', { keyPath: 'recordId' });
          db.createObjectStore('settings');
        }
        // case 1: futuras migraciones de stores o índices aquí.
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transacción abortada', 'AbortError'));
  });
}

/** Ejecuta `work(tx)` en una transacción y espera a que termine (o falle) entera. */
async function withTransaction(storeNames, mode, work) {
  const db = await openDb();
  const tx = db.transaction(storeNames, mode);
  const done = transactionDone(tx);
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    done.catch(() => {}); // el error ya se propaga; evitamos un "unhandled rejection" duplicado
    throw error;
  }
}

export function isQuotaError(error) {
  return error?.name === 'QuotaExceededError';
}

// ===== Registros =====

async function putRecordAndMedia(record, mediaBlob) {
  await withTransaction(['records', 'media'], 'readwrite', (tx) => {
    tx.objectStore('records').put(record);
    if (mediaBlob) tx.objectStore('media').put({ recordId: record.id, blob: mediaBlob });
  });
}

/**
 * Guarda un registro y, si lo hay, su archivo multimedia, todo en una sola transacción.
 * Si el almacenamiento está lleno, vuelve a intentarlo sin el multimedia: el registro
 * (hora y ubicación) es lo importante.
 * @returns {{ record: object, mediaDropped: boolean }}
 */
export async function saveRecord(record, mediaBlob = null) {
  try {
    await putRecordAndMedia(record, mediaBlob);
    return { record, mediaDropped: false };
  } catch (error) {
    if (!mediaBlob || !isQuotaError(error)) throw error;
    const withoutMedia = { ...record, media: null };
    await putRecordAndMedia(withoutMedia, null);
    return { record: withoutMedia, mediaDropped: true };
  }
}

/** Actualiza los datos de un registro existente (sin tocar su archivo multimedia). */
export async function updateRecord(record) {
  await withTransaction('records', 'readwrite', (tx) => {
    tx.objectStore('records').put(record);
  });
}

/** Todos los registros, del más reciente al más antiguo. */
export async function getAllRecords() {
  const records = await withTransaction('records', 'readonly', (tx) =>
    requestResult(tx.objectStore('records').index('createdAt').getAll()));
  return records.reverse().map(migrateRecord);
}

export async function getLatestRecord() {
  const cursor = await withTransaction('records', 'readonly', (tx) =>
    requestResult(tx.objectStore('records').index('createdAt').openCursor(null, 'prev')));
  return cursor ? migrateRecord(cursor.value) : null;
}

export async function getRecord(recordId) {
  const record = await withTransaction('records', 'readonly', (tx) =>
    requestResult(tx.objectStore('records').get(recordId)));
  return record ? migrateRecord(record) : null;
}

export async function getMediaBlob(recordId) {
  const row = await withTransaction('media', 'readonly', (tx) =>
    requestResult(tx.objectStore('media').get(recordId)));
  return row?.blob ?? null;
}

export async function deleteRecord(recordId) {
  await withTransaction(['records', 'media'], 'readwrite', (tx) => {
    tx.objectStore('records').delete(recordId);
    tx.objectStore('media').delete(recordId);
  });
}

/**
 * Borra los archivos multimedia de los registros antiguos y conserva el resto de datos
 * (y la miniatura, que ocupa muy poco).
 * @returns {number} cuántos archivos se han borrado
 */
export async function enforceMediaRetention(keep) {
  const toPurge = selectRecordsToPurge(await getAllRecords(), keep);
  if (toPurge.length === 0) return 0;
  await withTransaction(['records', 'media'], 'readwrite', (tx) => {
    for (const record of toPurge) {
      tx.objectStore('media').delete(record.id);
      tx.objectStore('records').put({ ...record, media: { ...record.media, purged: true } });
    }
  });
  return toPurge.length;
}

// ===== Ajustes =====

export async function getSettings() {
  const keys = Object.keys(DEFAULT_SETTINGS);
  const values = await withTransaction('settings', 'readonly', (tx) => {
    const store = tx.objectStore('settings');
    return Promise.all(keys.map((key) => requestResult(store.get(key))));
  });
  const settings = { ...DEFAULT_SETTINGS };
  keys.forEach((key, i) => { if (values[i] !== undefined) settings[key] = values[i]; });
  return settings;
}

export async function saveSetting(key, value) {
  await withTransaction('settings', 'readwrite', (tx) => {
    tx.objectStore('settings').put(value, key);
  });
}

// ===== Cuota del navegador =====

/** Pide que el navegador no borre nuestros datos aunque falte espacio. Chrome decide sin preguntar. */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function isStoragePersisted() {
  return (await navigator.storage?.persisted?.()) ?? false;
}

/** @returns {{ usage: number, quota: number } | null} */
export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
