// Punto de entrada: conecta los eventos de la interfaz con los módulos de datos, GPS y multimedia.

import * as ui from './ui.js';
import * as storage from './storage.js';
import { createRecord, selectRecordsToPurge } from './model.js';
import { plural } from './format.js';
import { acquireBestPosition, watchCurrentPosition, distanceMeters } from './location.js';
import {
  processPhoto, processVideoFile, isInAppRecordingSupported, openRearCamera, stopCamera,
  recordClip, captureVideoFrame, videoInfo, VIDEO_MAX_MS,
} from './media.js';

const { $ } = ui;

// ===== Estado actual (pantalla principal) =====

async function refreshStatus() {
  try {
    ui.renderStatus(await storage.getLatestRecord());
  } catch (error) {
    console.error(error);
    ui.toast('No se han podido leer los datos guardados.', 'error');
  }
}

// ===== Flujo de cierre: hoja → GPS en paralelo → Guardar =====

// Estado de la búsqueda de GPS de la hoja abierta.
let gps = null;          // { promise, stop } de acquireBestPosition
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
  gps.promise
    .then((fix) => { gpsState.fix = fix; })
    .catch((error) => { gpsState.error = error; })
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

// ----- Prueba visual: vídeo -----

let camera = null;             // MediaStream de la cámara trasera mientras el grabador está abierto
let recording = null;          // { done, stop } de la grabación en curso
let useVideoFallback = false;  // tras un fallo de cámara se usa la cámara del sistema

async function onVideoClicked() {
  if (useVideoFallback || !isInAppRecordingSupported()) {
    $('#video-input').click();
    return;
  }
  try {
    camera = await openRearCamera();
  } catch (error) {
    console.error(error);
    // No abrimos aquí el input directamente: tras el diálogo de permisos Chrome puede
    // bloquear el click por haber pasado demasiado tiempo desde que el usuario pulsó.
    useVideoFallback = true;
    const reason = error.code === 'denied' ? 'Sin permiso de cámara.' : 'No se puede grabar dentro de la app.';
    ui.toast(`${reason} Pulsa 🎥 Vídeo otra vez para usar la cámara del móvil.`, 'warning', 7000);
    return;
  }
  ui.showRecorder(camera);
}

function onRecordToggle() {
  if (recording) {
    recording.stop(); // parada manual antes de los 5 s
    return;
  }
  const current = recordClip(camera, { onTick: (remainingMs) => ui.renderRecorder('recording', remainingMs) });
  recording = current;
  ui.renderRecorder('recording', VIDEO_MAX_MS);

  current.done
    .then(async ({ blob, durationMs }) => {
      if (recording !== current) return; // se canceló
      ui.renderRecorder('processing');
      // La miniatura se saca de la vista previa, que sigue mostrando la cámara en directo.
      const preview = $('#recorder-preview');
      const thumbnail = await captureVideoFrame(preview).catch(() => null);
      const info = videoInfo(blob, { durationMs, width: preview.videoWidth, height: preview.videoHeight, thumbnail });
      setPendingMedia({ blob, info });
      $('#recorder').close();
    })
    .catch((error) => {
      if (recording !== current) return;
      console.error(error);
      $('#recorder').close();
      ui.toast('Ha fallado la grabación. Puedes intentarlo otra vez o guardar sin vídeo.', 'warning', 6000);
    });
}

// Se llama al cerrar el grabador de cualquier forma: siempre se libera la cámara.
function onRecorderClosed() {
  const current = recording;
  recording = null; // marca la grabación como cancelada si aún no había terminado
  current?.stop();
  stopCamera(camera);
  camera = null;
  ui.resetRecorder();
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
    gps.promise.catch(() => {}),
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
    });

    const { mediaDropped } = await storage.saveRecord(record, pendingMedia?.blob ?? null);
    closeLockSheet();
    navigator.vibrate?.(60); // confirmación táctil: se nota aunque no mires la pantalla
    await refreshStatus();
    afterSaveHousekeeping();
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
  $('#btn-save-now').addEventListener('click', () => skipGpsWait?.());

  $('#btn-photo').addEventListener('click', () => $('#photo-input').click());
  $('#photo-input').addEventListener('change', onPhotoChosen);
  $('#btn-proof-remove').addEventListener('click', () => setPendingMedia(null));

  $('#btn-video').addEventListener('click', onVideoClicked);
  $('#video-input').addEventListener('change', onVideoChosen);
  $('#btn-rec-toggle').addEventListener('click', onRecordToggle);
  $('#btn-rec-cancel').addEventListener('click', () => $('#recorder').close());
  $('#recorder').addEventListener('close', onRecorderClosed);
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
  const car = record?.location ?? null;
  const state = { record, distance: null, me: null, meError: null };
  mapModule.showCar(car);
  mapModule.clearMe();
  mapModule.recenter();
  ui.setDirectionsLink(car ? mapModule.directionsUrl(car) : null);
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
    const button = event.target.closest('[data-delete-id]');
    if (button) onDeleteRecord(button.dataset.deleteId);
  });
}

// ===== Almacenamiento =====

/** Tras guardar: pedir almacenamiento persistente y aplicar la retención de multimedia. */
async function afterSaveHousekeeping() {
  try {
    // Chrome concede (o no) la persistencia sin preguntar, según lo que se use la web;
    // pedirlo justo después de guardar algo importante es el mejor momento.
    await storage.requestPersistentStorage();
    const { mediaRetention } = await storage.getSettings();
    await storage.enforceMediaRetention(mediaRetention);
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
  setupHistory();
  setupStorage();
  registerServiceWorker();
  refreshStatus();
  handleLaunchParams();
  // «hace X min» tiene que avanzar solo, y actualizarse al volver a la app desde segundo plano.
  setInterval(refreshStatus, 60 * 1000);
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
