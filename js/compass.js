// Brújula del móvil. Chrome Android emite «deviceorientationabsolute», cuyo `alpha` es la
// rotación del móvil respecto al norte magnético (en sentido antihorario). A partir de ahí se
// calcula hacia dónde apunta la parte de arriba de la pantalla (el «heading», 0° = norte).

const NO_DATA_TIMEOUT_MS = 2000;

/**
 * @param {(headingDegrees: number) => void} onHeading  se llama con cada lectura nueva
 * @param {() => void} onUnavailable  el dispositivo no tiene brújula (o no da datos)
 * @returns {() => void} función para dejar de escuchar
 */
export function startCompass(onHeading, onUnavailable) {
  if (!('ondeviceorientationabsolute' in window)) {
    onUnavailable();
    return () => {};
  }

  let received = false;
  const handler = (event) => {
    if (event.alpha == null) return;
    received = true;
    // Si la pantalla está girada (apaisado), el «arriba» de la pantalla también gira.
    const screenAngle = screen.orientation?.angle ?? 0;
    onHeading((360 - event.alpha + screenAngle) % 360);
  };
  window.addEventListener('deviceorientationabsolute', handler);
  // Los ordenadores tienen el evento pero nunca lo disparan: si en 2 s no llega nada, no hay brújula.
  const timer = setTimeout(() => { if (!received) onUnavailable(); }, NO_DATA_TIMEOUT_MS);

  return () => {
    clearTimeout(timer);
    window.removeEventListener('deviceorientationabsolute', handler);
  };
}
