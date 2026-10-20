// Pantalla siempre encendida (Screen Wake Lock API) mientras buscas el coche con el mapa o la
// brújula: si se apaga a los 30 s, tienes que desbloquear el móvil a cada momento mientras caminas.
// Chrome suelta el bloqueo solo cuando la app pasa a segundo plano, así que al volver se pide otra vez.

/**
 * Mantiene la pantalla encendida hasta que se llame a la función devuelta.
 * Si el navegador no lo admite o lo deniega (p. ej. con ahorro de batería), no pasa nada.
 * @returns {() => void} función para dejar que la pantalla se apague otra vez
 */
export function keepScreenOn() {
  if (!('wakeLock' in navigator)) return () => {};
  let active = true;
  let sentinel = null;

  const request = async () => {
    if (sentinel && !sentinel.released) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (active) sentinel = lock;
      else lock.release(); // se canceló mientras se pedía
    } catch (error) {
      console.warn('No se puede mantener la pantalla encendida:', error);
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') request();
  };

  request();
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    active = false;
    document.removeEventListener('visibilitychange', onVisibility);
    sentinel?.release();
    sentinel = null;
  };
}
