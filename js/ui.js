// Todo lo que toca el DOM vive aquí, así app.js solo orquesta y es más fácil de leer.

import {
  formatRelative, formatDateTime, formatClock, formatDuration, formatBytes, formatDistance, describePlace, describeLocationError,
  formatCountdown, ticketTimeToTimestamp, timestampToTimeInput,
} from './format.js';
import { POOR_ACCURACY_M } from './location.js';
import { isParked } from './model.js';

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
/**
 * Mensaje breve en la parte inferior. type: 'info' | 'warning' | 'error'.
 * @param {{ label: string, onClick: () => void }} [action]  botón opcional (p. ej. «Deshacer»)
 */
export function toast(message, type = 'info', durationMs = 4000, action = null) {
  const el = $('#toast');
  el.className = `toast ${type}`;
  el.replaceChildren(Object.assign(document.createElement('span'), { textContent: message }));
  if (action) {
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'toast-action', textContent: action.label });
    button.addEventListener('click', () => {
      el.hidden = true;
      action.onClick();
    });
    el.append(button);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, durationMs);
}

// ===== Avisos de un registro (se usan en la tarjeta de estado y en el historial) =====

export function recordWarnings(record) {
  const warnings = [];
  if (!record.location) warnings.push(`Sin ubicación: ${describeLocationError(record.locationError)}`);
  else if (record.location.source === 'lastKnown') warnings.push(describeLastKnown(record.location, record.createdAt));
  else if (record.location.accuracy > POOR_ACCURACY_M) warnings.push(`Ubicación poco precisa (±${record.location.accuracy} m)`);
  return warnings;
}

/** "Ubicación aproximada: la última conocida, de 4 min antes de guardar" */
function describeLastKnown(location, savedAt) {
  const age = savedAt - location.capturedAt;
  return age >= 60 * 1000
    ? `Ubicación aproximada: la última conocida, de ${formatDuration(age)} antes de guardar (sin señal GPS)`
    : `Ubicación aproximada (sin señal GPS al guardar, ±${location.accuracy} m)`;
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

  // Coche ya recogido: se muestra cuándo, sin la prueba del cierre (ya no es relevante).
  if (!isParked(record)) {
    card.className = 'card status-card ended';
    card.innerHTML = `
      <div class="status-body">
        <p class="status-title">🚗 Coche recogido</p>
        <p class="status-time">${formatRelative(record.endedAt)} <span class="muted">· ${formatClock(record.endedAt)}</span></p>
        ${place ? `<p class="status-place">Estaba en: ${escapeHtml(place)}</p>` : ''}
      </div>`;
    return;
  }

  const accuracy = record.location ? ` <span class="muted">(±${record.location.accuracy} m)</span>` : '';
  card.className = 'card status-card locked';
  card.innerHTML = `
    <div class="status-main">
      ${thumbButton(record)}
      <div class="status-body">
        <p class="status-title">Cerrado ✅</p>
        <p class="status-time">${formatRelative(record.createdAt)} <span class="muted">· ${formatClock(record.createdAt)}</span></p>
        ${place ? `<p class="status-place">${escapeHtml(place)}${accuracy}</p>` : ''}
        ${ticketLine(record)}
        ${recordWarnings(record).map((w) => `<p class="status-warning">⚠️ ${escapeHtml(w)}</p>`).join('')}
      </div>
    </div>
    <div class="status-actions">
      <button type="button" class="btn" data-action="edit" data-record-id="${record.id}">✏️ Editar</button>
      <button type="button" class="btn" data-action="end-parking" data-record-id="${record.id}">🚗 Lo he recogido</button>
    </div>`;
}

/** "🅿️ Ticket: quedan 25 min (hasta 19:30)", en naranja si queda poco y en rojo si ha caducado. */
function ticketLine(record, now = Date.now()) {
  if (!record.ticketExpiresAt) return '';
  const left = record.ticketExpiresAt - now;
  const level = left < 0 ? 'expired' : left < 15 * 60 * 1000 ? 'soon' : 'ok';
  return `<p class="status-ticket ${level}">🅿️ Ticket: ${formatCountdown(left)}
    <span class="muted">(hasta ${timestampToTimeInput(record.ticketExpiresAt)})</span></p>`;
}

// ===== Campo «Ticket hasta» (hoja de cierre y diálogo de edición) =====

/** Rellena el campo con un ticket existente, recordando el valor original. */
export function setTicketInput(input, timestamp) {
  input.value = timestamp ? timestampToTimeInput(timestamp) : '';
  input.dataset.originalValue = input.value;
  input.dataset.originalTimestamp = timestamp ?? '';
}

/**
 * Lee el campo como instante. Si no se ha tocado se devuelve el original tal cual; si no,
 * un ticket ya caducado (p. ej. 19:00 a las 19:05) saltaría a mañana al reinterpretar la hora.
 */
export function readTicketInput(input) {
  if (!input.value) return null;
  if (input.value === input.dataset.originalValue && input.dataset.originalTimestamp) {
    return Number(input.dataset.originalTimestamp);
  }
  return ticketTimeToTimestamp(input.value);
}

export function setTicketFromNow(input, minutes) {
  input.value = timestampToTimeInput(Date.now() + minutes * 60 * 1000);
}

// ===== Diálogo «Editar registro» =====

export function openEditDialog(record) {
  $('#edit-note').value = record.note;
  setTicketInput($('#edit-ticket'), record.ticketExpiresAt);
  $('#edit-ticket-field').hidden = !isParked(record); // el ticket solo importa mientras está aparcado
  $('#edit-dialog').showModal();
}

// ===== Hoja de cierre =====

export function resetLockSheet() {
  $('#lock-form').reset();
  setTicketInput($('#lock-ticket'), null);
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
  if (fix?.source === 'lastKnown') {
    el.className = 'gps-status warning';
    el.innerHTML = `📍 Sin señal GPS: se usará tu última ubicación conocida<small>${escapeHtml(describeLastKnown(fix, Date.now()))}</small>`;
  } else if (fix) {
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
  if (!record) {
    info.innerHTML = 'No hay ninguna ubicación guardada.<small>Registra un cierre para verlo aquí.</small>';
    return;
  }
  if (!isParked(record)) {
    info.innerHTML = `No hay ningún coche aparcado.<small>Lo recogiste ${formatRelative(record.endedAt)}.</small>`;
    return;
  }
  if (!record.location) {
    info.innerHTML = '⚠️ El último cierre se guardó sin ubicación.<small>No hay posición del coche que mostrar.</small>';
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

// ===== Historial =====

export function renderHistory(records) {
  const list = $('#history-list');
  if (records.length === 0) {
    list.innerHTML = '<li class="empty">Todavía no hay registros.</li>';
    return;
  }
  list.innerHTML = records.map((record, index) => {
    const place = record.location
      ? `<a href="https://www.google.com/maps/search/?api=1&query=${record.location.lat},${record.location.lng}"
            target="_blank" rel="noopener">${escapeHtml(describePlace(record))}</a>`
      : escapeHtml(record.note);
    const meta = [];
    // Si la precisión es mala ya sale en el aviso; aquí no se repite.
    if (record.location && record.location.accuracy <= POOR_ACCURACY_M) meta.push(`±${record.location.accuracy} m`);
    if (record.endedAt) meta.push(`recogido ${formatClock(record.endedAt)} (${formatDuration(record.endedAt - record.createdAt)} aparcado)`);
    if (record.media) meta.push(record.media.purged
      ? `${record.media.type === 'video' ? 'vídeo borrado' : 'foto borrada'} (solo queda la miniatura)`
      : `${record.media.type === 'video' ? '🎥 vídeo' : '📷 foto'} · ${formatBytes(record.media.size)}`);
    const visual = thumbButton(record)
      || `<span class="thumb-placeholder" aria-hidden="true">${record.media?.type === 'video' ? '🎥' : '🔒'}</span>`;

    return `
      <li class="card history-item">
        ${visual}
        <div class="history-body">
          <p class="history-date">${formatDateTime(record.createdAt)}${index === 0 && isParked(record) ? '<span class="tag">Aparcado</span>' : ''}</p>
          ${place ? `<p class="history-place">${place}</p>` : ''}
          ${meta.length ? `<p class="history-meta">${meta.join(' · ')}</p>` : ''}
          ${recordWarnings(record).map((w) => `<p class="history-warning">⚠️ ${escapeHtml(w)}</p>`).join('')}
        </div>
        <div class="history-actions">
          <button type="button" class="btn-icon" data-edit-id="${record.id}" aria-label="Editar registro">✏️</button>
          <button type="button" class="btn-icon" data-delete-id="${record.id}" aria-label="Borrar registro">🗑️</button>
        </div>
      </li>`;
  }).join('');
}

// ===== Almacenamiento =====

/**
 * @param {{ estimate: {usage:number, quota:number}|null, persisted: boolean, persistSupported: boolean, retention: number }} info
 */
export function renderStorageInfo({ estimate, persisted, persistSupported, retention }) {
  $('#storage-usage').textContent = estimate
    ? `Usado: ${formatBytes(estimate.usage)} de ${formatBytes(estimate.quota)} disponibles.`
    : 'Este navegador no informa del espacio usado.';

  const persist = $('#storage-persist');
  if (persisted) {
    persist.className = 'persist-ok';
    persist.textContent = '✅ Datos protegidos: el navegador no los borrará aunque falte espacio.';
  } else {
    persist.className = 'persist-warn';
    persist.textContent = '⚠️ Si el móvil se queda sin espacio, el navegador podría borrar los datos. Instalar la app ayuda a protegerlos.';
  }
  $('#btn-persist').hidden = persisted || !persistSupported;

  const input = $('#retention-input');
  if (document.activeElement !== input) input.value = retention;
}
