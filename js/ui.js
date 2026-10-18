// Todo lo que toca el DOM vive aquí, así app.js solo orquesta y es más fácil de leer.

export const $ = (selector, root = document) => root.querySelector(selector);

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
export function toast(message, type = 'info', durationMs = 3500) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, durationMs);
}
