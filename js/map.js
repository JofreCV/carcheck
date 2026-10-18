// Mapa «¿Dónde está mi coche?» con Leaflet + teselas de OpenStreetMap.
// app.js carga este módulo con import() solo al abrir la vista del mapa, así la pantalla
// principal arranca rápido sin tener que leer los ~400 KB de Leaflet.

import { map as createMap, tileLayer, marker, divIcon, circle, circleMarker, latLngBounds } from '../vendor/leaflet/leaflet-src.esm.js';
import { TILE_URL } from './offline-tiles.js';

const DEFAULT_VIEW = { center: [40.4168, -3.7038], zoom: 5 }; // España, mientras no hay posiciones

let map = null;
let carMarker = null;
let carAccuracy = null;
let meMarker = null;
let meAccuracy = null;
// Mientras sea true, el mapa se reencuadra con cada posición nueva. Se desactiva en cuanto
// el usuario toca el mapa (para no quitarle el control) y se reactiva con «Centrar».
let autoFit = true;

const carIcon = divIcon({
  className: 'car-marker',
  html: '<span>🚗</span>',
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

/** Crea el mapa la primera vez; las siguientes solo recalcula su tamaño (estaba oculto). */
export function ensureMap(container) {
  if (map) {
    map.invalidateSize();
    return;
  }
  map = createMap(container, { zoomControl: true });
  map.attributionControl.setPosition('topright'); // abajo quedaría tapada por el panel
  container.addEventListener('pointerdown', () => { autoFit = false; });
  container.addEventListener('wheel', () => { autoFit = false; }, { passive: true });
  tileLayer(TILE_URL, {
    maxZoom: 19,
    // crossOrigin hace que las teselas lleguen como respuestas CORS: el Service Worker puede
    // cachearlas sin que cuenten como respuestas "opacas" (que Chrome contabiliza como ~7 MB cada una).
    crossOrigin: '',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
}

/** Coloca (o quita, si location es null) el marcador del coche. */
export function showCar(location) {
  carMarker?.remove();
  carAccuracy?.remove();
  carMarker = carAccuracy = null;
  if (!location) return;
  const latLng = [location.lat, location.lng];
  carAccuracy = circle(latLng, { radius: location.accuracy, color: '#0f766e', weight: 1, fillOpacity: 0.12 }).addTo(map);
  carMarker = marker(latLng, { icon: carIcon, title: 'Tu coche', zIndexOffset: 1000 }).addTo(map);
}

/** Actualiza el punto azul de la posición actual con su círculo de precisión. */
export function showMe(fix) {
  drawMe(fix);
  if (autoFit) fitToMarkers();
}

function drawMe(fix) {
  const latLng = [fix.lat, fix.lng];
  if (!meMarker) {
    meAccuracy = circle(latLng, { radius: fix.accuracy, color: '#2563eb', weight: 1, fillOpacity: 0.1 }).addTo(map);
    meMarker = circleMarker(latLng, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
  } else {
    meMarker.setLatLng(latLng);
    meAccuracy.setLatLng(latLng).setRadius(fix.accuracy);
  }
}

export function clearMe() {
  meMarker?.remove();
  meAccuracy?.remove();
  meMarker = meAccuracy = null;
}

/** Vuelve a encuadrar y a seguir la posición (botón «Centrar» y al entrar en la vista). */
export function recenter() {
  autoFit = true;
  fitToMarkers();
}

/** Encuadra el coche y la posición actual (o el que haya de los dos). */
function fitToMarkers() {
  const points = [carMarker, meMarker].filter(Boolean).map((m) => m.getLatLng());
  if (points.length === 0) return;
  if (points.length === 1) map.setView(points[0], 17);
  // Más margen abajo porque el panel con la distancia tapa esa parte del mapa.
  // maxZoom 17: es el zoom máximo de las teselas que se descargan al aparcar (offline-tiles.js).
  else map.fitBounds(latLngBounds(points), { paddingTopLeft: [48, 64], paddingBottomRight: [48, 260], maxZoom: 17 });
}

/** Enlace de Google Maps con la ruta a pie hasta el coche (abre la app en Android). */
export function directionsUrl({ lat, lng }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}
