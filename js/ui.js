// Todo lo que toca el DOM vive aquí, así app.js solo orquesta y es más fácil de leer.

import { formatRelative, formatDateTime, formatBytes, formatDistance, describePlace, describeLocationError } from './format.js';
import { POOR_ACCURACY_M } from './location.js';

export const $ = (selector, root = document) => root.querySelector(selector);

/** Escapa texto del usuario (la nota) antes de meterlo en HTML. */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Muestra una vista y marca su pestaña como activa. */
export function showView(name) {
  for (const view of document.querySelectorAll('.view')) {
    view.hidden = view.id !== `view-${name}`;
  }
  for (const tab of document.querySelectorAll('.tabbar button')) {
    if (tab.dataset.view === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

let toastTimer;
/** Mensaje breve en la parte inferior. type: 'info' | 'warning' | 'error'. */
export function toast(message, type = 'info', durationMs = 4000) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, durationMs);
}

// ===== Avisos de un registro (se usan en la tarjeta de estado y en el historial) =====

export function recordWarnings(record) {
  const warnings = [];
  if (!record.location) warnings.push(`Sin ubicación: ${describeLocationError(record.locationError)}`);
  else if (record.location.accuracy > POOR_ACCURACY_M) warnings.push(`Ubicación poco precisa (±${record.location.accuracy} m)`);
  return warnings;
}

// ===== Miniaturas =====
// Las miniaturas son Blobs; para mostrarlas hace falta una URL "blob:". Se reutiliza una por
// registro y se libera al borrarlo, para no ir acumulando memoria en cada refresco.
const thumbUrls = new Map();

function thumbUrl(record) {
  if (!record.media?.thumbnail) return null;
  let url = thumbUrls.get(record.id);
  if (!url) {
    url = URL.createObjectURL(record.media.thumbnail);
    thumbUrls.set(record.id, url);
  }
  return url;
}

export function forgetThumb(recordId) {
  const url = thumbUrls.get(recordId);
  if (url) URL.revokeObjectURL(url);
  thumbUrls.delete(recordId);
}

/** Botón con la miniatura; data-record-id permite abrir el visor al tocarlo. */
function thumbButton(record) {
  const url = thumbUrl(record);
  if (!url) return '';
  const badge = record.media.type === 'video' ? '▶ vídeo' : '';
  return `
    <button type="button" class="thumb" data-record-id="${record.id}" aria-label="Ver la prueba a pantalla completa">
      <img src="${url}" alt="">
      ${badge ? `<span class="badge">${badge}</span>` : ''}
    </button>`;
}

// ===== Tarjeta de estado =====

export function renderStatus(record) {
  const card = $('#status-card');
  if (!record) {
    card.className = 'card status-card';
    card.innerHTML = `
      <div class="status-body">
        <p class="status-title">Sin registro</p>
        <p class="status-place">Pulsa «Coche cerrado» cuando aparques.</p>
      </div>`;
    return;
  }

  const place = describePlace(record);
  const accuracy = record.location ? ` <span class="muted">(±${record.location.accuracy} m)</span>` : '';
  card.className = 'card status-card locked';
  card.innerHTML = `
    ${thumbButton(record)}
    <div class="status-body">
      <p class="status-title">Cerrado ✅</p>
      <p class="status-time">${formatRelative(record.createdAt)}</p>
      <p class="status-place">${place ? escapeHtml(place) + accuracy : formatDateTime(record.createdAt)}</p>
      ${recordWarnings(record).map((w) => `<p class="status-warning">⚠️ ${escapeHtml(w)}</p>`).join('')}
    </div>`;
}

// ===== Hoja de cierre =====

export function resetLockSheet() {
  $('#lock-form').reset();
  setSaving(false);
  showSaveNow(false);
  renderProofPreview(null);
}

let proofThumbUrl = null;
/**
 * Muestra la prueba elegida en la hoja, o los botones para elegir una si no hay.
 * @param {{ info: object } | null} media
 * @param {string} [busyText]  mensaje mientras se procesa ("Procesando foto…")
 */
export function renderProofPreview(media, busyText = '') {
  if (proofThumbUrl) URL.revokeObjectURL(proofThumbUrl);
  proofThumbUrl = null;

  const showPreview = Boolean(media || busyText);
  $('#proof-buttons').hidden = showPreview;
  $('#proof-preview').hidden = !showPreview;
  $('#btn-proof-remove').hidden = !media;

  const img = $('#proof-thumb');
  if (media?.info.thumbnail) {
    proofThumbUrl = URL.createObjectURL(media.info.thumbnail);
    img.src = proofThumbUrl;
    img.hidden = false;
  } else {
    img.removeAttribute('src');
    img.hidden = !media; // vídeo sin miniatura: se muestra el hueco vacío
  }

  if (busyText) $('#proof-info').textContent = busyText;
  else if (media) $('#proof-info').textContent = describeMedia(media.info);
}

function describeMedia(info) {
  const kind = info.type === 'video' ? '🎥 Vídeo' : '📷 Foto';
  const duration = info.durationMs ? ` · ${(info.durationMs / 1000).toFixed(1)} s` : '';
  return `${kind}${duration} · ${formatBytes(info.size)}`;
}

// ===== Visor a pantalla completa =====

let viewerUrl = null;

/**
 * @param {object} record
 * @param {Blob|null} blob  el archivo original; null si se borró por la retención
 */
export function openViewer(record, blob) {
  closeViewerMedia();
  const content = $('#viewer-content');
  if (blob) {
    viewerUrl = URL.createObjectURL(blob);
    content.innerHTML = record.media.type === 'video'
      // muted: los clips de la app no tienen audio y así Chrome permite el autoplay siempre.
      ? `<video src="${viewerUrl}" controls autoplay muted playsinline loop></video>`
      : `<img src="${viewerUrl}" alt="Foto del cierre">`;
  } else {
    content.innerHTML = `
      ${thumbUrl(record) ? `<img src="${thumbUrl(record)}" alt="Miniatura">` : ''}
      <p>El archivo original se borró para ahorrar espacio. Solo queda la miniatura.</p>`;
  }
  $('#viewer').showModal();
}

export function closeViewerMedia() {
  $('#viewer-content').innerHTML = ''; // detiene el vídeo si se estaba reproduciendo
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = null;
}

/**
 * Pinta el estado del GPS en la hoja.
 * @param {{ fix: object|null, error: Error|null, done: boolean }} gps
 */
export function renderGpsStatus({ fix, error, done }) {
  const el = $('#gps-status');
  if (fix) {
    const poor = fix.accuracy > POOR_ACCURACY_M;
    el.className = `gps-status ${poor ? 'warning' : 'ok'}`;
    const title = done ? `📍 Ubicación lista (±${fix.accuracy} m)` : `📡 Mejorando precisión… ±${fix.accuracy} m`;
    const hint = poor
      ? (done ? 'Precisión baja: se guardará igualmente.' : 'Precisión baja. Espera unos segundos o guarda igualmente.')
      : (done ? '' : 'Ya puedes guardar.');
    el.innerHTML = `${title}${hint ? `<small>${hint}</small>` : ''}`;
  } else if (!done) {
    el.className = 'gps-status';
    el.innerHTML = '📡 Buscando GPS…<small>Puedes ir escribiendo la nota mientras tanto.</small>';
  } else {
    el.className = 'gps-status error';
    el.innerHTML = `⚠️ Sin ubicación: ${escapeHtml(describeLocationError(error?.code))}<small>Se guardará el registro sin coordenadas.</small>`;
  }
}

export function setSaving(saving, label = 'Guardando…') {
  const button = $('#btn-save');
  button.disabled = saving;
  button.textContent = saving ? label : 'Guardar';
}

export function showSaveNow(visible) {
  $('#btn-save-now').hidden = !visible;
}

// ===== Grabador de vídeo =====

export function showRecorder(stream) {
  $('#recorder-preview').srcObject = stream;
  renderRecorder('ready');
  $('#recorder').showModal();
}

/** state: 'ready' (encuadrando) | 'recording' | 'processing' */
export function renderRecorder(state, remainingMs = 0) {
  const toggle = $('#btn-rec-toggle');
  const countdown = $('#recorder-countdown');
  const hint = $('#recorder-hint');
  countdown.hidden = state !== 'recording';
  toggle.disabled = state === 'processing';
  if (state === 'ready') {
    toggle.textContent = '⏺ Grabar';
    hint.textContent = 'Encuadra la manija y pulsa Grabar (máx. 5 s).';
  } else if (state === 'recording') {
    toggle.textContent = '⏹ Parar';
    countdown.textContent = `● ${Math.ceil(remainingMs / 1000)}`;
    hint.textContent = 'Grabando… se para solo a los 5 s.';
  } else {
    toggle.textContent = 'Procesando…';
    hint.textContent = '';
  }
}

export function resetRecorder() {
  $('#recorder-preview').srcObject = null;
}

// ===== Vista del mapa =====

/**
 * @param {{ record: object|null, distance: number|null, me: object|null, meError: Error|null }} state
 */
export function renderMapInfo({ record, distance, me, meError }) {
  const info = $('#map-info');
  if (!record?.location) {
    info.innerHTML = record
      ? '⚠️ El último cierre se guardó sin ubicación.<small>No hay posición del coche que mostrar.</small>'
      : 'No hay ninguna ubicación guardada.<small>Registra un cierre para verlo aquí.</small>';
    return;
  }
  const when = `Cerrado ${formatRelative(record.createdAt)}${record.note ? ` · ${escapeHtml(record.note)}` : ''}`;
  if (distance != null) {
    info.innerHTML = `🚗 A ${formatDistance(distance)} de ti<small>${when}</small>`;
  } else if (meError) {
    info.innerHTML = `🚗 Tu coche<small>${when}. No se puede saber dónde estás: ${escapeHtml(describeLocationError(meError.code))}.</small>`;
  } else {
    info.innerHTML = `🚗 Tu coche<small>${when}. Buscando tu posición…</small>`;
  }
}

export function setDirectionsLink(url) {
  const link = $('#btn-directions');
  link.hidden = !url;
  if (url) link.href = url;
}
