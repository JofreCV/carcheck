// Mini framework de tests para el navegador: sin node ni dependencias.
// Resultado visible en la página y en document.title ("PASS n/n" o "FAIL x/n").

import { SCHEMA_VERSION, createRecord, createMediaInfo, migrateRecord, selectRecordsToPurge, isParked } from '../js/model.js';
import * as storage from '../js/storage.js';
import {
  formatRelative, formatClock, formatDuration, formatDistance, formatBytes, describePlace,
  ticketTimeToTimestamp, timestampToTimeInput, formatCountdown, shareText, setFloorInNote, floorInNote,
} from '../js/format.js';
import { distanceMeters, bearingDegrees } from '../js/location.js';
import { buildAddress, findNearbyAddress } from '../js/geocode.js';
import { zoomLevels } from '../js/media.js';
import { tileFor, tilesAround, tileUrl, isTileRecent } from '../js/offline-tiles.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(condition, message = 'la condición es falsa') {
  if (!condition) throw new Error(message);
}
function assertEqual(actual, expected, message = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} esperado ${e}, obtenido ${a}`);
}

// ===== model.js =====

test('createRecord rellena los campos obligatorios', () => {
  const r = createRecord({ note: '  Planta -2  ', now: 1000 });
  assertEqual(r.schemaVersion, SCHEMA_VERSION);
  assertEqual(r.createdAt, 1000);
  assertEqual(r.locked, true);
  assertEqual(r.note, 'Planta -2', 'la nota se recorta:');
  assertEqual(r.vehicleId, 'default');
  assert(typeof r.id === 'string' && r.id.length > 10, 'id generado');
});

test('createRecord descarta locationError si hay ubicación', () => {
  const r = createRecord({ location: { lat: 1, lng: 2, accuracy: 5, capturedAt: 0 }, locationError: 'timeout' });
  assertEqual(r.locationError, null);
});

test('migrateRecord completa campos ausentes de registros antiguos', () => {
  const r = migrateRecord({ id: 'x', createdAt: 5 });
  assertEqual(r.schemaVersion, SCHEMA_VERSION);
  assertEqual(r.note, '');
  assertEqual(r.media, null);
  assertEqual(r.vehicleId, 'default');
});

test('migración v1 → v2: añade endedAt, ticketExpiresAt y location.source', () => {
  const v1 = { schemaVersion: 1, id: 'a', createdAt: 1, note: 'n', location: { lat: 1, lng: 2, accuracy: 5, capturedAt: 0 } };
  const r = migrateRecord(v1);
  assertEqual(r.schemaVersion, 2);
  assertEqual(r.endedAt, null);
  assertEqual(r.ticketExpiresAt, null);
  assertEqual(r.location.source, 'gps');
  assertEqual(r.note, 'n');
  assertEqual(migrateRecord({ schemaVersion: 1, id: 'b', createdAt: 1, location: null }).location, null);
});

test('isParked', () => {
  assertEqual(isParked(null), false);
  assertEqual(isParked(createRecord()), true);
  assertEqual(isParked({ ...createRecord(), endedAt: 123 }), false);
});

test('migrateRecord respeta los valores existentes', () => {
  const r = migrateRecord({ id: 'x', createdAt: 5, schemaVersion: 1, note: 'hola' });
  assertEqual(r.note, 'hola');
});

const withMedia = (id, purged = false) => ({ id, media: { ...createMediaInfo({ type: 'photo', mimeType: 'image/jpeg', size: 1 }), purged } });

test('selectRecordsToPurge conserva los N más recientes con multimedia', () => {
  const records = [withMedia('a'), { id: 'b', media: null }, withMedia('c'), withMedia('d'), withMedia('e')];
  assertEqual(selectRecordsToPurge(records, 2).map((r) => r.id), ['d', 'e']);
});

test('selectRecordsToPurge ignora los ya purgados y no falla con N mayor que el total', () => {
  const records = [withMedia('a'), withMedia('b', true)];
  assertEqual(selectRecordsToPurge(records, 1).map((r) => r.id), []);
  assertEqual(selectRecordsToPurge(records, 10).map((r) => r.id), []);
});

// ===== format.js y location.js =====

test('formatRelative', () => {
  const now = 10 * 24 * 3600e3;
  assertEqual(formatRelative(now - 20e3, now), 'hace un momento');
  assertEqual(formatRelative(now - 5 * 60e3, now), 'hace 5 min');
  assertEqual(formatRelative(now - (2 * 3600e3 + 14 * 60e3), now), 'hace 2 h 14 min');
  assertEqual(formatRelative(now - 3 * 3600e3, now), 'hace 3 h');
  assertEqual(formatRelative(now - (3 * 24 * 3600e3 + 4 * 3600e3), now), 'hace 3 d 4 h');
});

test('formatClock: hoy, ayer y fecha completa', () => {
  const now = new Date(2026, 9, 18, 20, 0).getTime();
  assertEqual(formatClock(new Date(2026, 9, 18, 18, 32).getTime(), now), 'hoy 18:32');
  assertEqual(formatClock(new Date(2026, 9, 17, 23, 5).getTime(), now), 'ayer 23:05');
  assert(formatClock(new Date(2026, 9, 10, 9, 0).getTime(), now).includes('oct'), 'fecha completa');
});

test('formatDuration', () => {
  assertEqual(formatDuration(30e3), 'menos de 1 min');
  assertEqual(formatDuration(2 * 3600e3 + 5 * 60e3), '2 h 5 min');
  assertEqual(formatDuration(26 * 3600e3), '1 d 2 h');
});

test('ticketTimeToTimestamp: hoy si aún no ha pasado, mañana si ya pasó', () => {
  const now = new Date(2026, 9, 18, 18, 0).getTime();
  assertEqual(ticketTimeToTimestamp('19:30', now), new Date(2026, 9, 18, 19, 30).getTime());
  assertEqual(ticketTimeToTimestamp('09:15', now), new Date(2026, 9, 19, 9, 15).getTime());
  assertEqual(timestampToTimeInput(new Date(2026, 9, 18, 7, 5).getTime()), '07:05');
});

test('formatCountdown', () => {
  assertEqual(formatCountdown(25 * 60e3), 'quedan 25 min');
  assertEqual(formatCountdown(-5 * 60e3), 'caducado hace 5 min');
  assertEqual(formatCountdown(59.5 * 60e3), 'quedan 1 h');
});

test('shareText', () => {
  const location = { lat: 41.1189, lng: 1.2445, accuracy: 8 };
  assertEqual(shareText({ note: 'Planta -2', address: 'Carrer Major 12, Tarragona', location }),
    '🚗 Mi coche está aquí (Planta -2 · Carrer Major 12, Tarragona): https://www.google.com/maps/search/?api=1&query=41.1189,1.2445');
  assertEqual(shareText({ note: '', address: null, location }),
    '🚗 Mi coche está aquí: https://www.google.com/maps/search/?api=1&query=41.1189,1.2445');
});

test('setFloorInNote y floorInNote (botones de planta)', () => {
  assertEqual(setFloorInNote('', '-2'), 'Planta -2');
  assertEqual(setFloorInNote('plaza 47', '-2'), 'Planta -2, plaza 47', 'se añade delante:');
  assertEqual(setFloorInNote('Planta -2, plaza 47', '-3'), 'Planta -3, plaza 47', 'se sustituye:');
  assertEqual(setFloorInNote('junto al ascensor, planta -1', '-4'), 'junto al ascensor, Planta -4');
  assertEqual(floorInNote('Planta -3, plaza 47'), '-3');
  assertEqual(floorInNote('plaza 47'), null);
});

test('formatDistance y formatBytes', () => {
  assertEqual(formatDistance(349.6), '350 m');
  assertEqual(formatDistance(1234), '1,2 km');
  assertEqual(formatDistance(15400), '15 km');
  assertEqual(formatBytes(512), '512 B');
  assertEqual(formatBytes(1.5 * 1024 * 1024), '1,5 MB');
});

test('describePlace prioriza la nota y si no hay usa coordenadas', () => {
  const location = { lat: 41.118912, lng: 1.244512, accuracy: 8 };
  assertEqual(describePlace({ note: 'Plaza 47', location }), 'Plaza 47');
  assertEqual(describePlace({ note: '', location }), '41.11891, 1.24451');
  assertEqual(describePlace({ note: '', location: null }), '');
});

test('distanceMeters (haversine) Tarragona–Reus ≈ 13 km', () => {
  const d = distanceMeters({ lat: 41.1189, lng: 1.2445 }, { lat: 41.1561, lng: 1.1069 });
  assert(d > 12000 && d < 13000, `distancia ${d}`);
  assertEqual(distanceMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0);
});

test('bearingDegrees: norte, este, sur y oeste', () => {
  const o = { lat: 41, lng: 1 };
  const near = (a, b) => Math.abs(a - b) < 0.5;
  assert(near(bearingDegrees(o, { lat: 41.01, lng: 1 }), 0), 'norte');
  assert(near(bearingDegrees(o, { lat: 41, lng: 1.01 }), 90), 'este');
  assert(near(bearingDegrees(o, { lat: 40.99, lng: 1 }), 180), 'sur');
  assert(near(bearingDegrees(o, { lat: 41, lng: 0.99 }), 270), 'oeste');
});

test('tileFor y tilesAround (teselas de OSM)', () => {
  assertEqual(tileFor(0, 0, 1), { z: 1, x: 1, y: 1 });
  assertEqual(tileFor(85, -180, 2), { z: 2, x: 0, y: 0 });
  const around = tilesAround(41.1189, 1.2445, 17, 1);
  assertEqual(around.length, 9);
  assertEqual(around[4], tileFor(41.1189, 1.2445, 17), 'la central está en medio:');
  assertEqual(tileUrl({ z: 3, x: 4, y: 5 }), 'https://tile.openstreetmap.org/3/4/5.png');
});

test('isTileRecent: las teselas se reutilizan durante 7 días', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const day = 24 * 3600e3;
  const tile = (fetchedAt) => new Response('', { headers: fetchedAt ? { 'x-carcheck-fetched-at': String(fetchedAt) } : {} });
  assertEqual(isTileRecent(tile(now - 2 * day), now), true);
  assertEqual(isTileRecent(tile(now - 8 * day), now), false);
  assertEqual(isTileRecent(tile(null), now), false, 'sin marca (versión anterior) se vuelve a pedir:');
});

test('buildAddress (respuesta de Nominatim)', () => {
  assertEqual(buildAddress({ address: { road: 'Carrer Major', house_number: '12', city: 'Tarragona' } }), 'Carrer Major 12, Tarragona');
  assertEqual(buildAddress({ address: { pedestrian: 'Rambla Nova', town: 'Reus' } }), 'Rambla Nova, Reus');
  assertEqual(buildAddress({ address: { village: 'Altafulla' } }), 'Altafulla');
  assertEqual(buildAddress({ error: 'Unable to geocode' }), '');
});

test('findNearbyAddress reutiliza la calle de un aparcamiento cercano y preciso', () => {
  const here = { lat: 41.1189, lng: 1.2445 };
  const at = (dLat, accuracy, address) => ({ address, location: { lat: here.lat + dLat, lng: here.lng, accuracy } });
  // 0,0001° de latitud ≈ 11 m
  assertEqual(findNearbyAddress(here, [at(0.0002, 10, 'Lejos 1'), at(0.0001, 10, 'Cerca 2')]), 'Cerca 2', 'el más cercano:');
  assertEqual(findNearbyAddress(here, [at(0.0004, 10, 'A 44 m')]), null, 'a más de 25 m no sirve:');
  assertEqual(findNearbyAddress(here, [at(0.0001, 80, 'Impreciso')]), null, 'con mala precisión no se fía:');
  assertEqual(findNearbyAddress(here, [at(0.0001, 10, ''), at(0, 10, null), { address: 'X', location: null }]), null,
    'sin dirección o sin ubicación no cuenta:');
});

test('zoomLevels: 1×, 2× y 3× dentro de lo que admite la cámara', () => {
  assertEqual(zoomLevels({ min: 1, max: 8 }), [1, 2, 3]);
  assertEqual(zoomLevels({ min: 1, max: 2.5 }), [1, 2]);
  assertEqual(zoomLevels({ min: 1, max: 1.5 }), [1, 1.5], 'si solo cabe 1×, de mínimo a máximo:');
});

// ===== storage.js (sobre una base de datos de pruebas) =====

async function freshDatabase() {
  await storage.useDatabaseForTests('carcheck-test');
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('carcheck-test');
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });
}

test('storage: guarda y lee registros ordenados por fecha', async () => {
  await freshDatabase();
  await storage.saveRecord(createRecord({ note: 'viejo', now: 1000 }));
  await storage.saveRecord(createRecord({ note: 'nuevo', now: 2000 }));
  const all = await storage.getAllRecords();
  assertEqual(all.map((r) => r.note), ['nuevo', 'viejo']);
  assertEqual((await storage.getLatestRecord()).note, 'nuevo');
});

test('storage: guarda el blob aparte y lo borra con el registro', async () => {
  await freshDatabase();
  const record = createRecord({ media: createMediaInfo({ type: 'photo', mimeType: 'image/jpeg', size: 3 }) });
  await storage.saveRecord(record, new Blob(['abc'], { type: 'image/jpeg' }));
  const blob = await storage.getMediaBlob(record.id);
  assertEqual(await blob.text(), 'abc');
  await storage.deleteRecord(record.id);
  assertEqual(await storage.getMediaBlob(record.id), null);
  assertEqual(await storage.getLatestRecord(), null);
});

test('storage: la retención borra archivos antiguos pero conserva los datos', async () => {
  await freshDatabase();
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const record = createRecord({ now: i, note: `r${i}`, media: createMediaInfo({ type: 'photo', mimeType: 'image/jpeg', size: 1 }) });
    ids.push(record.id);
    await storage.saveRecord(record, new Blob(['x']));
  }
  assertEqual(await storage.enforceMediaRetention(2), 2);
  const all = await storage.getAllRecords();
  assertEqual(all.length, 4, 'se conservan todos los registros:');
  assertEqual(all.map((r) => r.media.purged), [false, false, true, true]);
  assertEqual(await storage.getMediaBlob(ids[0]), null);
  assert(await storage.getMediaBlob(ids[3]), 'el más reciente conserva el archivo');
});

test('storage: updateRecord cambia los datos sin tocar el archivo', async () => {
  await freshDatabase();
  const record = createRecord({ media: createMediaInfo({ type: 'photo', mimeType: 'image/jpeg', size: 3 }) });
  await storage.saveRecord(record, new Blob(['abc']));
  await storage.updateRecord({ ...record, endedAt: 999 });
  assertEqual((await storage.getRecord(record.id)).endedAt, 999);
  assertEqual(await (await storage.getMediaBlob(record.id)).text(), 'abc');
});

test('storage: patchRecord cambia campos sueltos y sustituye o quita el archivo', async () => {
  await freshDatabase();
  const record = createRecord({ note: 'nota' });
  await storage.saveRecord(record);
  const location = { lat: 1, lng: 2, accuracy: 5, capturedAt: 0, source: 'gps' };
  const { record: patched } = await storage.patchRecord(record.id, { location });
  assertEqual(patched.note, 'nota', 'conserva lo que no cambia:');
  assertEqual((await storage.getRecord(record.id)).location, location);

  const info = createMediaInfo({ type: 'photo', mimeType: 'image/jpeg', size: 3 });
  await storage.patchRecord(record.id, {}, { blob: new Blob(['abc']), info });
  assertEqual((await storage.getRecord(record.id)).media.size, 3);
  assertEqual(await (await storage.getMediaBlob(record.id)).text(), 'abc');

  await storage.patchRecord(record.id, {}, null);
  assertEqual((await storage.getRecord(record.id)).media, null);
  assertEqual(await storage.getMediaBlob(record.id), null, 'el archivo se borra:');

  assertEqual((await storage.patchRecord('no-existe', { note: 'x' })).record, null);
});

test('storage: ajustes con valores por defecto', async () => {
  await freshDatabase();
  assertEqual((await storage.getSettings()).mediaRetention, 10);
  await storage.saveSetting('mediaRetention', 5);
  assertEqual((await storage.getSettings()).mediaRetention, 5);
});

// ===== Ejecución =====

async function run() {
  const list = document.getElementById('results');
  let failed = 0;
  for (const { name, fn } of tests) {
    const li = document.createElement('li');
    try {
      await fn();
      li.className = 'pass';
      li.textContent = `✔ ${name}`;
    } catch (error) {
      failed++;
      li.className = 'fail';
      li.textContent = `✘ ${name}`;
      const pre = document.createElement('pre');
      pre.textContent = error.stack || String(error);
      li.append(pre);
    }
    list.append(li);
  }
  const summary = failed ? `FAIL ${failed}/${tests.length}` : `PASS ${tests.length}/${tests.length}`;
  document.getElementById('summary').textContent = summary;
  document.title = summary;
  // Informe en texto para el servidor de desarrollo (tools/devserver.py); en otros servidores se ignora.
  const report = [summary, ...[...list.children].map((li) => li.textContent)].join('\n');
  fetch('/__report', { method: 'POST', body: report }).catch(() => {});
}

run();
