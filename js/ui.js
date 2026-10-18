// Todo lo que toca el DOM vive aquí, así app.js solo orquesta y es más fácil de leer.

import { formatRelative, formatDateTime, describePlace, describeLocationError } from './format.js';
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
