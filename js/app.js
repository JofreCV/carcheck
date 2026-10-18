// Punto de entrada: conecta los eventos de la interfaz con los módulos de datos, GPS y multimedia.

import * as ui from './ui.js';
import * as storage from './storage.js';
import { createRecord } from './model.js';
import { acquireBestPosition } from './location.js';
import { processPhoto } from './media.js';

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
let processingMedia = false;
let saving = false;

function openLockSheet() {
  ui.resetLockSheet();
  pendingMedia = null;
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

  processingMedia = true;
  ui.renderProofPreview(null, 'Procesando foto…');
  try {
    setPendingMedia(await processPhoto(file));
  } catch (error) {
    console.error(error);
    setPendingMedia(null);
    ui.toast('No se ha podido procesar la foto. Puedes guardar sin ella.', 'warning');
  } finally {
    processingMedia = false;
  }
}

function setPendingMedia(media) {
  pendingMedia = media;
  ui.renderProofPreview(media);
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
    if (!$('#lock-sheet').open) return; // la hoja se cerró mientras esperábamos
    if (processingMedia) {
      ui.toast('Espera a que termine de procesarse la foto.', 'info');
      return;
    }

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
    await refreshStatus();
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

// ===== Navegación =====

function setupNavigation() {
  for (const tab of document.querySelectorAll('.tabbar button')) {
    tab.addEventListener('click', () => ui.showView(tab.dataset.view));
  }
}

// ===== Arranque =====

function init() {
  setupNavigation();
  setupLockFlow();
  setupViewer();
  refreshStatus();
  // «hace X min» tiene que avanzar solo, y actualizarse al volver a la app desde segundo plano.
  setInterval(refreshStatus, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshStatus();
  });
}

init();
