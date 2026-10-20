// Punto de entrada: conecta los eventos de la interfaz con los módulos de datos, GPS y multimedia.

import * as ui from './ui.js';
import * as storage from './storage.js';
import { createRecord, selectRecordsToPurge, isParked } from './model.js';
import { plural, shareText } from './format.js';
import { reverseGeocode, findNearbyAddress } from './geocode.js';
import { prefetchParkingTiles } from './offline-tiles.js';
import { acquireBestPosition, getLastKnownPosition, watchCurrentPosition, distanceMeters, bearingDegrees } from './location.js';
import { startCompass } from './compass.js';
import {
  processPhoto, processVideoFile, isCameraSupported, isInAppRecordingSupported, openRearCamera, stopCamera,
  recordClip, captureVideoFrame, videoInfo, takePhoto, supportsTorch, setTorch, VIDEO_MAX_MS,
} from './media.js';

const { $ } = ui;

// ===== Estado actual (pantalla principal) =====

async function refreshStatus() {
  try {
    const latest = await storage.getLatestRecord();
    ui.renderStatus(latest);
    scheduleTicketReminders(latest);
  } catch (error) {
    console.error(error);
    ui.toast('No se han podido leer los datos guardados.', 'error');
  }
}

// ===== Flujo de cierre: hoja → GPS en paralelo → Guardar =====

// Estado de la búsqueda de GPS de la hoja abierta.
let gps = null;          // { promise, stop } de acquireBestPosition
let gpsSettled = null;   // promesa que termina cuando ya se sabe la ubicación final (o que no hay)
let gpsState = null;     // { fix, error, done }
let skipGpsWait = null;  // resuelve la espera cuando se pulsa «Guardar sin esperar»
let pendingMedia = null; // { blob, info } de la foto o el vídeo elegidos, aún sin guardar
let mediaProcessing = null; // promesa mientras se comprime una foto o se lee un vídeo
let sheetSession = 0;       // distingue cada apertura de la hoja (para descartar resultados tardíos)
let saving = false;

function openLockSheet() {
  ui.resetLockSheet();
  pendingMedia = null;
  sheetSession++;
  gpsState = { fix: null, error: null, done: false };
  ui.renderGpsStatus(gpsState);
  $('#lock-sheet').showModal();

  gps = acquireBestPosition({
    onUpdate: (fix) => {
      gpsState.fix = fix;
      ui.renderGpsStatus(gpsState);
    },
  });
  gpsSettled = gps.promise
    .then((fix) => { gpsState.fix = fix; })
    .catch(async (error) => {
      gpsState.error = error;
      // Sin señal (no por permiso denegado): probar con la última ubicación conocida.
      if (error.code === 'denied' || error.code === 'unsupported') return;
      const fallback = await getLastKnownPosition().catch(() => null);
      if (fallback) gpsState.fix = fallback;
    })
    .finally(() => {
      gpsState.done = true;
      ui.renderGpsStatus(gpsState);
    });
}

function closeLockSheet() {
  $('#lock-sheet').close();
}

// Se llama al cerrar la hoja de cualquier forma (Cancelar, botón atrás o tras guardar).
function onLockSheetClosed() {
  gps?.stop();
  skipGpsWait?.();
  pendingMedia = null;
}

// ----- Prueba visual: foto -----

async function onPhotoChosen(event) {
  const file = event.target.files[0];
  event.target.value = ''; // permite volver a elegir la misma foto
  if (!file) return; // el usuario cerró la cámara sin hacer foto

  await processMedia(processPhoto(file), 'Procesando foto…', 'No se ha podido procesar la foto. Puedes guardar sin ella.');
}

/**
 * Muestra "Procesando…" mientras dura `task` y deja el resultado como prueba pendiente.
 * La promesa se guarda para que «Guardar» pueda esperarla en vez de fallar.
 */
function processMedia(task, busyText, errorText) {
  const session = sheetSession;
  ui.renderProofPreview(null, busyText);
  mediaProcessing = task
    .then((media) => {
      if (session === sheetSession) setPendingMedia(media);
    })
    .catch((error) => {
      console.error(error);
      if (session !== sheetSession) return;
      setPendingMedia(null);
      ui.toast(errorText, 'warning');
    })
    .finally(() => { mediaProcessing = null; });
  return mediaProcessing;
}

function setPendingMedia(media) {
  pendingMedia = media;
  ui.renderProofPreview(media);
}

// ----- Cámara dentro de la app (foto y vídeo) -----

let camera = null;      // MediaStream de la cámara trasera mientras el diálogo está abierto
let cameraMode = null;  // 'photo' | 'video'
let torchOn = false;
let recording = null;   // { done, stop } de la grabación en curso
// Tras un fallo de cámara (p. ej. permiso denegado) se usa la cámara del sistema con <input capture>.
const useSystemCamera = { photo: false, video: false };

const CAMERA_LABELS = { photo: '📷 Foto', video: '🎥 Vídeo' };

/** @param {'photo'|'video'} mode */
async function openCamera(mode) {
  const supported = mode === 'photo' ? isCameraSupported() : isInAppRecordingSupported();
  if (useSystemCamera[mode] || !supported) {
    $(mode === 'photo' ? '#photo-input' : '#video-input').click();
    return;
  }
  try {
    camera = await openRearCamera({ highRes: mode === 'photo' });
  } catch (error) {
    console.error(error);
    // No abrimos aquí el input directamente: tras el diálogo de permisos Chrome puede
    // bloquear el click por haber pasado demasiado tiempo desde que el usuario pulsó.
    useSystemCamera[mode] = true;
    const reason = error.code === 'denied' ? 'Sin permiso de cámara.' : 'No se puede usar la cámara dentro de la app.';
    ui.toast(`${reason} Pulsa ${CAMERA_LABELS[mode]} otra vez para usar la cámara del móvil.`, 'warning', 7000);
    return;
  }
  cameraMode = mode;
  torchOn = false;
  ui.showCamera(camera, mode, supportsTorch(camera));
}

function onShutter() {
  if (cameraMode === 'photo') onTakePhoto();
  else onRecordToggle();
}

async function onTakePhoto() {
  ui.renderCamera('processing');
  try {
    const photo = await takePhoto(camera, $('#camera-preview'));
    $('#camera').close();
    await processMedia(processPhoto(photo), 'Procesando foto…', 'No se ha podido procesar la foto. Puedes guardar sin ella.');
  } catch (error) {
    console.error(error);
    $('#camera').close();
    ui.toast('No se ha podido hacer la foto. Puedes intentarlo otra vez o guardar sin ella.', 'warning', 6000);
  }
}

async function onTorchToggle() {
  try {
    await setTorch(camera, !torchOn);
    torchOn = !torchOn;
    ui.setTorchButton(torchOn);
  } catch (error) {
    console.error(error);
    ui.toast('No se ha podido encender la linterna.', 'warning');
  }
}

function onRecordToggle() {
  if (recording) {
    recording.stop(); // parada manual antes de los 5 s
    return;
  }
  const current = recordClip(camera, { onTick: (remainingMs) => ui.renderCamera('recording', remainingMs) });
  recording = current;
  ui.renderCamera('recording', VIDEO_MAX_MS);

  current.done
    .then(async ({ blob, durationMs }) => {
      if (recording !== current) return; // se canceló
      ui.renderCamera('processing');
      // La miniatura se saca de la vista previa, que sigue mostrando la cámara en directo.
      const preview = $('#camera-preview');
      const thumbnail = await captureVideoFrame(preview).catch(() => null);
      const info = videoInfo(blob, { durationMs, width: preview.videoWidth, height: preview.videoHeight, thumbnail });
      setPendingMedia({ blob, info });
      $('#camera').close();
    })
    .catch((error) => {
      if (recording !== current) return;
      console.error(error);
      $('#camera').close();
      ui.toast('Ha fallado la grabación. Puedes intentarlo otra vez o guardar sin vídeo.', 'warning', 6000);
    });
}

// Se llama al cerrar la cámara de cualquier forma: siempre se libera (y se apaga la linterna).
function onCameraClosed() {
  const current = recording;
  recording = null; // marca la grabación como cancelada si aún no había terminado
  current?.stop();
  stopCamera(camera);
  camera = null;
  cameraMode = null;
  ui.resetCamera();
}

async function onVideoChosen(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;

  await processMedia(processVideoFile(file), 'Procesando vídeo…', 'No se ha podido procesar el vídeo. Puedes guardar sin él.');
}

/** Si aún no hay ninguna lectura de GPS, espera a que llegue o a que el usuario decida no esperar. */
async function waitForGpsIfNeeded() {
  if (gpsState.fix || gpsState.done) return;
  ui.setSaving(true, 'Esperando GPS…');
  ui.showSaveNow(true);
  await Promise.race([
    gpsSettled,
    new Promise((resolve) => { skipGpsWait = resolve; }),
  ]);
  skipGpsWait = null;
  ui.showSaveNow(false);
}

async function saveLockRecord() {
  if (saving) return;
  saving = true;
  try {
    await waitForGpsIfNeeded();
    if (mediaProcessing) {
      ui.setSaving(true, 'Procesando…');
      await mediaProcessing;
    }
    if (!$('#lock-sheet').open) return; // la hoja se cerró mientras esperábamos

    gps.stop(); // nos quedamos con la mejor lectura que haya
    ui.setSaving(true);

    const fix = gpsState.fix;
    const locationError = fix ? null : (gpsState.error?.code ?? 'skipped');
    const record = createRecord({
      location: fix,
      locationError,
      note: $('#note-input').value,
      media: pendingMedia?.info ?? null,
      ticketExpiresAt: ui.readTicketInput($('#lock-ticket')),
    });
    if (record.ticketExpiresAt) requestNotificationPermission();

    const previous = await storage.getLatestRecord();
    const { mediaDropped } = await storage.saveRecord(record, pendingMedia?.blob ?? null);
    // Aparcar de nuevo implica que el aparcamiento anterior terminó: se cierra para que
    // el historial sea coherente (aparcado desde → recogido hasta).
    if (isParked(previous)) await storage.updateRecord({ ...previous, endedAt: record.createdAt });
    closeLockSheet();
    navigator.vibrate?.(60); // confirmación táctil: se nota aunque no mires la pantalla
    await refreshStatus();
    afterSaveHousekeeping(record);
    if (mediaDropped) ui.toast('Almacenamiento lleno: se ha guardado el cierre sin la foto/vídeo.', 'warning', 6000);
    else ui.toast(fix ? '🔒 Cierre guardado' : '🔒 Cierre guardado sin ubicación', fix ? 'info' : 'warning');
  } catch (error) {
    console.error(error);
    ui.toast(storage.isQuotaError(error)
      ? 'El almacenamiento está lleno: borra registros del historial.'
      : 'No se ha podido guardar el registro.', 'error', 6000);
    ui.setSaving(false);
  } finally {
    saving = false;
  }
}

function setupLockFlow() {
  $('#btn-lock').addEventListener('click', openLockSheet);
  $('#btn-sheet-cancel').addEventListener('click', closeLockSheet);
  $('#lock-sheet').addEventListener('close', onLockSheetClosed);
  $('#lock-form').addEventListener('submit', (event) => {
    event.preventDefault(); // el formulario solo existe para que «Intro» en la nota guarde
    saveLockRecord();
  });
  // «Guardar sin esperar»: se corta la búsqueda; si no había lectura, se intenta enseguida
  // con la última ubicación conocida (gpsSettled) en vez de guardar sin nada.
  $('#btn-save-now').addEventListener('click', () => gps?.stop());

  $('#btn-photo').addEventListener('click', () => openCamera('photo'));
  $('#btn-video').addEventListener('click', () => openCamera('video'));
  $('#photo-input').addEventListener('change', onPhotoChosen);
  $('#video-input').addEventListener('change', onVideoChosen);
  $('#btn-proof-remove').addEventListener('click', () => setPendingMedia(null));

  $('#btn-cam-shutter').addEventListener('click', onShutter);
  $('#btn-torch').addEventListener('click', onTorchToggle);
  $('#btn-cam-cancel').addEventListener('click', () => $('#camera').close());
  $('#camera').addEventListener('close', onCameraClosed);
}

// ===== Dirección (geocodificación inversa) =====

let geocoding = false;

/**
 * Busca la dirección de los registros que aún no la tienen (address === null), empezando por
 * los más recientes. Primero reutiliza la de un aparcamiento anterior a pocos metros (sin red);
 * si no la hay, pregunta a Nominatim, con un máximo de `limit` peticiones por llamada.
 * Si falla la red se para y se reintentará en otro momento (al guardar, al abrir o al volver la conexión).
 */
async function fillMissingAddresses(limit = 5) {
  if (geocoding) return;
  geocoding = true;
  let updated = false;
  try {
    const all = await storage.getAllRecords();
    const pending = all.filter((record) => record.location && record.address === null);
    let requests = 0;
    for (const record of pending) {
      let address = findNearbyAddress(record.location, all);
      if (address === null) {
        if (!navigator.onLine || requests >= limit) continue;
        requests++;
        address = await reverseGeocode(record.location);
      }
      const fresh = await storage.getRecord(record.id); // pudo borrarse o editarse mientras tanto
      if (!fresh) continue;
      await storage.updateRecord({ ...fresh, address });
      record.address = address; // `record` está en `all`: así sirve de vecino a los siguientes
      updated = true;
    }
  } catch (error) {
    console.warn('No se ha podido obtener la dirección:', error);
  } finally {
    geocoding = false;
  }
  if (updated) {
    refreshStatus();
    if (currentView === 'history') refreshHistory();
  }
}

// ===== «Lo he recogido» =====

async function onEndParking(recordId) {
  try {
    const record = await storage.getRecord(recordId);
    if (!isParked(record)) return;
    await storage.updateRecord({ ...record, endedAt: Date.now() });
    await refreshStatus();
    ui.toast('🚗 Coche marcado como recogido', 'info', 7000, {
      label: 'Deshacer',
      onClick: async () => {
        await storage.updateRecord({ ...record, endedAt: null });
        refreshStatus();
      },
    });
  } catch (error) {
    console.error(error);
    ui.toast('No se ha podido actualizar el registro.', 'error');
  }
}

function setupStatusActions() {
  $('#status-card').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button?.dataset.action === 'end-parking') onEndParking(button.dataset.recordId);
    if (button?.dataset.action === 'edit') openEdit(button.dataset.recordId);
  });
}

// ===== Editar registro (nota y ticket) =====

let editingId = null;

async function openEdit(recordId) {
  const record = await storage.getRecord(recordId);
  if (!record) return;
  editingId = recordId;
  ui.openEditDialog(record);
}

async function onEditSubmit() {
  try {
    const record = await storage.getRecord(editingId);
    if (!record) return;
    const ticketExpiresAt = isParked(record) ? ui.readTicketInput($('#edit-ticket')) : record.ticketExpiresAt;
    await storage.updateRecord({ ...record, note: $('#edit-note').value.trim(), ticketExpiresAt });
    $('#edit-dialog').close();
    if (ticketExpiresAt && ticketExpiresAt !== record.ticketExpiresAt) requestNotificationPermission();
    await refreshStatus();
    if (currentView === 'history') refreshHistory();
    ui.toast('Cambios guardados');
  } catch (error) {
    console.error(error);
    ui.toast('No se han podido guardar los cambios.', 'error');
  }
}

function setupEditing() {
  $('#edit-form').addEventListener('submit', (event) => {
    event.preventDefault();
    onEditSubmit();
  });
  $('#btn-edit-cancel').addEventListener('click', () => $('#edit-dialog').close());
  // Botones rápidos del ticket (30 min, 1 h, 2 h, ✕), en la hoja de cierre y en el diálogo.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ticket-minutes], [data-ticket-clear]');
    if (!button) return;
    const input = button.closest('.ticket-field').querySelector('.ticket-input');
    if (button.dataset.ticketMinutes) ui.setTicketFromNow(input, Number(button.dataset.ticketMinutes));
    else input.value = '';
  });
}

// ===== Avisos del ticket de zona azul =====
// Sin servidor no se puede programar una notificación que llegue con la app cerrada: estos
// temporizadores solo funcionan mientras la página siga viva (abierta o en segundo plano reciente).

let ticketTimers = [];
let ticketTimersKey = '';

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(() => refreshStatus());
  }
}

function scheduleTicketReminders(record) {
  const key = isParked(record) && record.ticketExpiresAt ? `${record.id}:${record.ticketExpiresAt}` : '';
  if (key === ticketTimersKey) return; // nada ha cambiado desde la última vez
  ticketTimersKey = key;
  ticketTimers.forEach(clearTimeout);
  ticketTimers = [];
  if (!key || !('Notification' in window) || Notification.permission !== 'granted') return;

  const now = Date.now();
  const reminders = [
    { at: record.ticketExpiresAt - 10 * 60 * 1000, body: 'Tu ticket de zona azul caduca en 10 minutos.' },
    { at: record.ticketExpiresAt, body: 'Tu ticket de zona azul ha caducado.' },
  ];
  for (const { at, body } of reminders) {
    if (at > now) ticketTimers.push(setTimeout(() => notify(body), at - now));
  }
}

async function notify(body) {
  const options = { body, icon: 'icons/icon-192.png', tag: 'ticket', renotify: true, vibrate: [200, 100, 200] };
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) registration.showNotification('CarCheck · Zona azul', options);
  else new Notification('CarCheck · Zona azul', options);
}

// ===== Visor de la prueba (miniaturas de la tarjeta de estado y del historial) =====

async function openRecordMedia(recordId) {
  try {
    const record = await storage.getRecord(recordId);
    if (!record?.media) return;
    const blob = record.media.purged ? null : await storage.getMediaBlob(recordId);
    ui.openViewer(record, blob);
  } catch (error) {
    console.error(error);
    ui.toast('No se ha podido abrir el archivo.', 'error');
  }
}

function setupViewer() {
  // Delegación: las miniaturas se repintan a menudo, así que escuchamos en el documento.
  document.addEventListener('click', (event) => {
    const thumb = event.target.closest('.thumb[data-record-id]');
    if (thumb) openRecordMedia(thumb.dataset.recordId);
  });
  $('#btn-viewer-close').addEventListener('click', () => $('#viewer').close());
  $('#viewer').addEventListener('close', ui.closeViewerMedia);
}

// ===== Mapa =====

let mapModule = null;      // se carga la primera vez que se abre la vista (import dinámico)
let stopWatchingMe = null; // deja de seguir la posición al salir del mapa (ahorra batería)
let mapEntryId = 0;        // cada entrada al mapa tiene un número; las anteriores se descartan
let mapCar = null;         // ubicación del coche que muestra el mapa (para la brújula)

async function enterMapView() {
  const entryId = ++mapEntryId;
  // Tras cada await: si el usuario ya se ha ido del mapa (o ha vuelto a entrar), no seguir.
  // Si no, el GPS se quedaría encendido en otra pestaña.
  const stillHere = () => entryId === mapEntryId && currentView === 'map';

  try {
    mapModule ??= await import('./map.js');
  } catch (error) {
    console.error(error);
    $('#map-info').textContent = 'No se ha podido cargar el mapa. ¿Estás sin conexión?';
    return;
  }
  if (!stillHere()) return;
  mapModule.ensureMap($('#map'));

  const record = await storage.getLatestRecord();
  if (!stillHere()) return;
  // Si el coche ya está recogido no tiene sentido marcar dónde estuvo.
  const car = isParked(record) ? record.location : null;
  mapCar = car;
  const state = { record, distance: null, me: null, meError: null };
  mapModule.showCar(car);
  mapModule.clearMe();
  mapModule.recenter();
  ui.setCarActions({ directionsUrl: car ? mapModule.directionsUrl(car) : null });
  ui.renderMapInfo(state);

  stopWatchingMe?.();
  stopWatchingMe = watchCurrentPosition(
    (fix) => {
      state.me = fix;
      state.meError = null;
      state.distance = car ? distanceMeters(fix, car) : null;
      mapModule.showMe(fix);
      ui.renderMapInfo(state);
    },
    (error) => {
      state.meError = error;
      ui.renderMapInfo(state);
    },
  );
}

function leaveMapView() {
  mapEntryId++; // invalida una entrada que aún se esté cargando
  stopWatchingMe?.();
  stopWatchingMe = null;
}

// ===== Brújula =====

let stopCompassSensors = null;

function openCompass() {
  if (!mapCar) return;
  const car = mapCar;
  const state = { distance: null, bearing: null, heading: null, noCompass: false, meError: null, accuracy: null };
  const update = () => ui.renderCompass(state);
  update();
  $('#compass').showModal();

  const stopGps = watchCurrentPosition(
    (fix) => {
      Object.assign(state, {
        distance: distanceMeters(fix, car), bearing: bearingDegrees(fix, car), accuracy: fix.accuracy, meError: null,
      });
      update();
    },
    (error) => { state.meError = error; update(); },
  );
  const stopHeading = startCompass(
    (heading) => { state.heading = heading; update(); },
    () => { state.noCompass = true; update(); },
  );
  stopCompassSensors = () => { stopGps(); stopHeading(); };
}

// ===== Compartir ubicación =====

async function onShare() {
  const record = await storage.getLatestRecord();
  if (!isParked(record) || !record.location) return;
  const text = shareText(record);
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Ubicación de mi coche', text });
    } else {
      await navigator.clipboard.writeText(text);
      ui.toast('📋 Ubicación copiada: pégala donde quieras');
    }
  } catch (error) {
    if (error.name !== 'AbortError') { // AbortError = el usuario cerró el menú de compartir
      console.error(error);
      ui.toast('No se ha podido compartir la ubicación.', 'error');
    }
  }
}

function setupCompass() {
  $('#btn-compass').addEventListener('click', openCompass);
  $('#btn-share').addEventListener('click', onShare);
  $('#btn-compass-close').addEventListener('click', () => $('#compass').close());
  // Al cerrar (✕ o botón atrás) se apagan el GPS y la brújula.
  $('#compass').addEventListener('close', () => {
    stopCompassSensors?.();
    stopCompassSensors = null;
  });
}

// ===== Historial =====

async function refreshHistory() {
  try {
    ui.renderHistory(await storage.getAllRecords());
  } catch (error) {
    console.error(error);
    ui.toast('No se ha podido leer el historial.', 'error');
  }
}

async function onDeleteRecord(recordId) {
  if (!confirm('¿Borrar este registro? También se borrará su foto o vídeo.')) return;
  try {
    await storage.deleteRecord(recordId);
    ui.forgetThumb(recordId);
    await Promise.all([refreshHistory(), refreshStatus(), refreshStorageInfo()]);
    ui.toast('Registro borrado');
  } catch (error) {
    console.error(error);
    ui.toast('No se ha podido borrar el registro.', 'error');
  }
}

function setupHistory() {
  $('#history-list').addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-delete-id]');
    if (deleteButton) onDeleteRecord(deleteButton.dataset.deleteId);
    const editButton = event.target.closest('[data-edit-id]');
    if (editButton) openEdit(editButton.dataset.editId);
  });
}

// ===== Almacenamiento =====

/**
 * Tareas en segundo plano tras guardar: almacenamiento persistente, retención de multimedia,
 * dirección de la calle y teselas del mapa de la zona (para usarlo luego sin datos).
 */
async function afterSaveHousekeeping(record) {
  if (record.location && navigator.onLine) prefetchParkingTiles(record.location).catch(console.warn);
  try {
    // Chrome concede (o no) la persistencia sin preguntar, según lo que se use la web;
    // pedirlo justo después de guardar algo importante es el mejor momento.
    await storage.requestPersistentStorage();
    const { mediaRetention } = await storage.getSettings();
    await storage.enforceMediaRetention(mediaRetention);
    fillMissingAddresses();
  } catch (error) {
    console.error(error); // no es crítico: el registro ya está guardado
  }
}

async function refreshStorageInfo() {
  try {
    const [estimate, persisted, settings] = await Promise.all([
      storage.getStorageEstimate(),
      storage.isStoragePersisted(),
      storage.getSettings(),
    ]);
    ui.renderStorageInfo({
      estimate,
      persisted,
      persistSupported: Boolean(navigator.storage?.persist),
      retention: settings.mediaRetention,
    });
  } catch (error) {
    console.error(error);
  }
}

async function onPersistClicked() {
  const granted = await storage.requestPersistentStorage();
  ui.toast(granted
    ? '🛡️ Datos protegidos'
    : 'Chrome no lo ha concedido todavía. Instala la app en la pantalla de inicio y vuelve a intentarlo.',
  granted ? 'info' : 'warning', 6000);
  refreshStorageInfo();
}

async function onRetentionChanged(event) {
  const input = event.target;
  const value = Math.round(Number(input.value));
  const { mediaRetention: current } = await storage.getSettings();
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    ui.toast('Elige un número entre 1 y 100.', 'warning');
    input.value = current;
    return;
  }
  if (value === current) return;

  // Bajar el número borra archivos para siempre: avisar antes de hacerlo.
  const toPurge = selectRecordsToPurge(await storage.getAllRecords(), value);
  if (toPurge.length > 0 && !confirm(`Se borrarán ${plural(toPurge.length, 'foto o vídeo antiguo', 'fotos o vídeos antiguos')}. ¿Continuar?`)) {
    input.value = current;
    return;
  }
  await storage.saveSetting('mediaRetention', value);
  const purged = await storage.enforceMediaRetention(value);
  await Promise.all([refreshHistory(), refreshStorageInfo()]);
  ui.toast(purged ? `Guardado. Archivos antiguos borrados: ${purged}.` : 'Guardado.');
}

function setupStorage() {
  $('#btn-persist').addEventListener('click', onPersistClicked);
  $('#retention-input').addEventListener('change', onRetentionChanged);
}

// ===== Navegación =====

let currentView = 'home';

function navigate(view) {
  if (view === currentView) return;
  if (currentView === 'map') leaveMapView();
  currentView = view;
  ui.showView(view);
  if (view === 'map') enterMapView();
  if (view === 'history') {
    refreshHistory();
    refreshStorageInfo();
  }
}

function setupNavigation() {
  for (const tab of document.querySelectorAll('.tabbar button')) {
    tab.addEventListener('click', () => navigate(tab.dataset.view));
  }
  $('#btn-center').addEventListener('click', () => mapModule?.recenter());
}

// ===== PWA =====

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('./sw.js').catch((error) => console.error('Service Worker:', error));

  // Cuando se instala una versión nueva, recargar para usarla. Si el usuario está a mitad
  // de algo (hoja de cierre, grabación, visor), se espera a que cierre el diálogo.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // primera instalación: la página ya es la versión actual
    const reloadWhenIdle = () => {
      if (document.querySelector('dialog[open]')) setTimeout(reloadWhenIdle, 1000);
      else location.reload();
    };
    reloadWhenIdle();
  });
}

/** Accesos directos del icono (manifest «shortcuts»): ?action=lock y ?view=map. */
function handleLaunchParams() {
  const params = new URLSearchParams(location.search);
  if (params.get('view') === 'map') navigate('map');
  if (params.get('action') === 'lock') openLockSheet();
  if (location.search) history.replaceState(null, '', location.pathname); // que recargar no lo repita
}

// ===== Arranque =====

function init() {
  setupNavigation();
  setupLockFlow();
  setupViewer();
  setupStatusActions();
  setupEditing();
  setupCompass();
  setupHistory();
  setupStorage();
  registerServiceWorker();
  refreshStatus();
  handleLaunchParams();
  fillMissingAddresses();
  window.addEventListener('online', () => fillMissingAddresses());
  // «hace X min» y la cuenta atrás del ticket tienen que avanzar solos, y actualizarse
  // al volver a la app desde segundo plano.
  setInterval(refreshStatus, 30 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshStatus();
      if (currentView === 'map') enterMapView();
    } else if (currentView === 'map') {
      leaveMapView(); // no gastar GPS con la app en segundo plano
    }
  });
}

init();
