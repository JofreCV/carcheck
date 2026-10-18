# CarCheck — guía para Claude

PWA personal para registrar que el coche está cerrado (con prueba en foto o vídeo) y dónde está aparcado.
Usuario: Jofre, estudiante de Ingeniería Informática.

## Reparto de trabajo (obligatorio en todas las sesiones)
- **Claude hace todo el trabajo técnico**: escribe el código, crea los archivos, ejecuta comandos, instala lo necesario, hace los commits, prueba y despliega.
- **El usuario no escribe código.** Nada de TODOs, fragmentos para completar ni pasos del tipo «añade esto en el archivo X». Si algo exige una acción suya (autenticarse en GitHub, aceptar un permiso en el móvil…), se le dan pasos concretos y sin código.
- **El usuario quiere entender el código.** Después de cada funcionalidad o cambio, explícale en pocas líneas qué has hecho, en qué archivos y por qué.
- Las peticiones futuras de cambios o funciones se implementan directamente siguiendo estas mismas reglas.
- Mantén este archivo actualizado cuando cambie algo relevante (stack, arquitectura, modelo de datos, convenciones).

## Plataforma objetivo
- **Chrome en Android.** De momento no se trabaja en las limitaciones de iOS/Safari. Si en el futuro hace falta soporte para iOS, se añadirá entonces.

## Stack
- HTML + CSS + JavaScript vanilla con ES modules. **Sin frameworks ni build step.**
- PWA: `manifest.webmanifest` + `sw.js` (cache-first para el app shell, network-first para las teselas del mapa).
- Datos solo en el dispositivo con IndexedDB, mediante un wrapper propio (`js/storage.js`). Sin backend.
- Mapa: Leaflet 1.9.4 copiado en `vendor/leaflet/` (build ESM) + teselas de OpenStreetMap. Es la única dependencia externa.
- Despliegue: GitHub Pages desde la rama `main` (carpeta raíz). Repo: `carcheck` (público).

## Arquitectura
| Archivo | Responsabilidad |
|---|---|
| `index.html` | App shell: vistas Inicio / Mapa / Historial, barra inferior, hoja de cierre y diálogos |
| `css/styles.css` | Estilos mobile-first, tokens de color en `:root` y modo oscuro automático |
| `js/app.js` | Arranque, navegación entre vistas y orquestación de los flujos |
| `js/ui.js` | Todo lo que pinta en el DOM (tarjeta de estado, historial, hoja, toasts) |
| `js/format.js` | Funciones puras de formato (tiempo relativo, distancia, bytes…) |
| `js/model.js` | Modelo de datos versionado: `SCHEMA_VERSION`, `createRecord`, `migrateRecord`, reglas de retención |
| `js/storage.js` | IndexedDB (records, media, settings), retención de multimedia, `persist`/`estimate` |
| `js/location.js` | Geolocalización con la mejor precisión posible, errores tipados y haversine |
| `js/media.js` | Foto (compresión con canvas), vídeo (MediaRecorder + fallback con input) y miniaturas |
| `js/map.js` | Leaflet: marcador del coche, posición actual y enlace a Google Maps |
| `sw.js` | Service Worker |
| `tests/index.html` | Tests en el navegador (sin node) |
| `tools/` | Servidor de desarrollo (`devserver.py`) y túnel HTTPS (`dev.ps1`) |

## Modelo de datos (IndexedDB `carcheck`)
- `records` (keyPath `id`, índice `createdAt`): `{ schemaVersion, id, vehicleId, createdAt, locked, location, locationError, address, note, media }`.
  - `location`: `null` o `{ lat, lng, accuracy, capturedAt }`. `locationError`: `null` | `denied` | `timeout` | `unavailable` | `unsupported` | `skipped` (se guardó sin esperar al GPS).
  - `media`: `null` o `{ type: "photo"|"video", mimeType, size, width, height, durationMs, thumbnail: Blob, purged }`.
- `media` (keyPath `recordId`): `{ recordId, blob }`. El archivo grande va aparte para que listar no cargue vídeos y para que purgar consista en borrar una fila.
- `settings` (clave/valor): `mediaRetention` (por defecto 10). La retención conserva el archivo de los N registros **con multimedia** más recientes; de los demás borra el blob y marca `media.purged = true` (la miniatura se queda).
- **Para añadir campos:** sube `SCHEMA_VERSION` en `model.js` y añade un paso en `MIGRATIONS`. Si cambian los stores o índices, sube `DB_VERSION` en `storage.js` y añade un `case` en `onupgradeneeded`, sin `break`.

## Convenciones
- Comentarios en español, los justos, explicando el porqué más que el qué.
- Código claro antes que ingenioso. Nada de dependencias innecesarias.
- Rutas siempre relativas (`./…`), porque Pages sirve la app bajo `/carcheck/`.
- Cada operación que pueda fallar (GPS, cámara, grabación, cuota) tiene que dejar guardar el registro igualmente, aunque sea sin coordenadas o sin multimedia.
- **Cada vez que cambie un archivo del app shell, sube `CACHE_VERSION` en `sw.js`** y, si añades archivos, inclúyelos en `SHELL_FILES`.
- Un commit por funcionalidad, con mensajes descriptivos.
- `map.js` (y Leaflet) se cargan con `import()` al abrir el mapa; no importarlo de forma estática desde `app.js`.
- Accesos directos del manifest: `?action=lock` abre la hoja de cierre y `?view=map` abre el mapa (`handleLaunchParams` en `app.js`).
- Cuando se instala un Service Worker nuevo, la página se recarga sola, pero espera a que no haya ningún `<dialog>` abierto.

## Desarrollo y pruebas
- `powershell -ExecutionPolicy Bypass -File tools/dev.ps1` levanta el servidor en `http://localhost:8080` y un túnel de cloudflared que imprime la URL `https://….trycloudflare.com` para abrirla en el móvil.
- Tests unitarios y de IndexedDB: abre `http://localhost:8080/tests/`. Al terminar, la página envía un informe en texto a `POST /__report` del devserver (se escribe en `tools/.test-report`), y así se pueden ejecutar en Chrome headless y leer el resultado desde la terminal.
- Pruebas E2E: Chrome headless controlado por el DevTools Protocol (geolocalización simulada, `--use-fake-device-for-media-stream` para la cámara, `Network.emulateNetworkConditions` para el modo offline). **El perfil de Chrome tiene que estar en una ruta corta** (p. ej. `%TEMP%\cc-carcheck`): con rutas largas, CacheStorage falla con «Unexpected internal error» y el Service Worker no se instala.
- Herramientas instaladas en Windows: cloudflared (`C:\Program Files (x86)\cloudflared\`), gh (`C:\Program Files\GitHub CLI\`), Python 3.13.

## Ideas futuras (la arquitectura ya está preparada)
- Exportar e importar en JSON (serializar `records`, `settings` y los blobs en base64).
- Recordatorio de la zona azul (Notifications API).
- Varios vehículos (`vehicleId` ya existe en cada registro).
- Geocodificación inversa con Nominatim (campo `address` reservado; respetar su política: 1 petición/s y sin peticiones masivas).
