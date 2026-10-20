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
- Despliegue: GitHub Pages desde la rama `main` (carpeta raíz). Repo: https://github.com/JofreCV/carcheck (público). URL: https://jofrecv.github.io/carcheck/. Publicar = `git push` a `main` (gh ya está autenticado como JofreCV; `gh.exe` está en `C:\Program Files\GitHub CLI\`, que no está en el PATH de la sesión).

## Arquitectura
| Archivo | Responsabilidad |
|---|---|
| `index.html` | App shell: vistas Inicio / Mapa / Historial, barra inferior, hoja de cierre y diálogos (cámara, editar, brújula, visor) |
| `css/styles.css` | Estilos mobile-first, tokens de color en `:root` y modo oscuro automático |
| `js/app.js` | Arranque, navegación entre vistas y orquestación de los flujos (incluida la «sesión de cierre», ver Convenciones) |
| `js/ui.js` | Todo lo que pinta en el DOM (tarjeta de estado, historial, hoja, toasts) |
| `js/format.js` | Funciones puras de formato (tiempo relativo, duración, cuenta atrás del ticket, distancia, texto para compartir…) |
| `js/model.js` | Modelo de datos versionado: `SCHEMA_VERSION`, `MIGRATIONS`, `createRecord`, `migrateRecord`, `isParked`, reglas de retención |
| `js/storage.js` | IndexedDB (records, media, settings), `patchRecord` atómico, retención de multimedia, `persist`/`estimate` |
| `js/location.js` | Geolocalización con la mejor precisión, última ubicación conocida, haversine y rumbo |
| `js/media.js` | Cámara en la app (foto con ImageCapture, vídeo con MediaRecorder, linterna, zoom), compresión, miniaturas y fallback con input |
| `js/map.js` | Leaflet: marcador del coche, posición actual, encuadre y enlace a Google Maps (carga diferida) |
| `js/geocode.js` | Dirección de la calle: primero `findNearbyAddress` (historial, ≤25 m), si no Nominatim (cola de 1 petición/1,1 s) — único módulo que habla con un servicio externo de datos |
| `js/compass.js` | Brújula (`deviceorientationabsolute`) para la flecha hacia el coche |
| `js/offline-tiles.js` | Matemática de teselas y precarga de 19 teselas alrededor del coche al aparcar (sin Leaflet); conserva las zonas recientes 7 días |
| `js/wake-lock.js` | Pantalla encendida (Screen Wake Lock) mientras el mapa enseña el coche o la brújula está abierta |
| `sw.js` | Service Worker |
| `tests/index.html` | Tests en el navegador (sin node) |
| `tools/` | Servidor de desarrollo (`devserver.py`) y túnel HTTPS (`dev.ps1`) |

## Modelo de datos (IndexedDB `carcheck`)
- `records` (keyPath `id`, índice `createdAt`), **schemaVersion 2**: `{ schemaVersion, id, vehicleId, createdAt, locked, location, locationError, address, note, media, endedAt, ticketExpiresAt }`.
  - `location`: `null` o `{ lat, lng, accuracy, capturedAt, source: 'gps'|'lastKnown' }`. `locationError`: `null` | `denied` | `timeout` | `unavailable` | `unsupported` | `skipped`.
  - `address`: `null` = pendiente de buscar en Nominatim, `''` = sin resultado, texto = calle.
  - `endedAt`: cuándo se recogió el coche (`null` = sigue aparcado; ver `isParked`). Al guardar un registro nuevo se cierra el anterior.
  - `ticketExpiresAt`: fin del ticket de zona azul (epoch ms) o `null`.
  - Historial de migraciones: v1 → v2 añadió `endedAt`, `ticketExpiresAt` y `location.source`.
  - `media`: `null` o `{ type: "photo"|"video", mimeType, size, width, height, durationMs, thumbnail: Blob, purged }`.
- `media` (keyPath `recordId`): `{ recordId, blob }`. El archivo grande va aparte para que listar no cargue vídeos y para que purgar consista en borrar una fila.
- `settings` (clave/valor): `mediaRetention` (por defecto 10). La retención conserva el archivo de los N registros **con multimedia** más recientes; de los demás borra el blob y marca `media.purged = true` (la miniatura se queda).
- **Para añadir campos:** sube `SCHEMA_VERSION` en `model.js` y añade un paso en `MIGRATIONS`. Si cambian los stores o índices, sube `DB_VERSION` en `storage.js` y añade un `case` en `onupgradeneeded`, sin `break`.
- **Para cambiar campos de un registro que ya existe, usa `storage.patchRecord(id, campos, media?)`**: lee y escribe en la misma transacción, así el GPS que afina en segundo plano no pisa una edición hecha a la vez. `updateRecord(registroEntero)` solo para casos en que ya tienes el registro completo y nadie más lo puede tocar.

## Convenciones
- Comentarios en español, los justos, explicando el porqué más que el qué.
- Código claro antes que ingenioso. Nada de dependencias innecesarias.
- Rutas siempre relativas (`./…`), porque Pages sirve la app bajo `/carcheck/`.
- Cada operación que pueda fallar (GPS, cámara, grabación, cuota) tiene que dejar guardar el registro igualmente, aunque sea sin coordenadas o sin multimedia.
- **Antes de cada despliegue que toque el app shell, sube `CACHE_VERSION` en `sw.js`** (va por `v4`) y, si añades archivos, inclúyelos en `SHELL_FILES`.
- Un commit por funcionalidad, con mensajes descriptivos.
- `map.js` (y Leaflet) se cargan con `import()` al abrir el mapa; no importarlo de forma estática desde `app.js`.
- **Flujo de cierre («cerrar primero, detallar después»)**: `startLock()` crea y guarda el registro al pulsar el botón; la hoja solo añade detalles. Todo vive en `lockSession` (app.js): las escrituras van encadenadas en `session.writes` (en orden) y usan `patchRecord`. La ubicación se guarda en cada mejora del GPS; la nota, 500 ms después de dejar de teclear y al cerrar. Al cerrar la hoja (`endLockSheet`), el GPS sigue hasta su límite y `finishLock` hace el mantenimiento (teselas, retención, direcciones). Sin señal, al cerrar se guarda ya la última ubicación conocida (pedida al empezar). «Descartar» borra el registro y devuelve el anterior a «aparcado».
- El evento `close` de un `<dialog>` llega un instante después de `close()`: la lógica de cierre se llama directamente desde `closeLockSheet()` y el evento solo cubre el botón atrás/Esc (y se ignora si la hoja ya se ha vuelto a abrir).
- Accesos directos del manifest: `?action=lock` registra el cierre (también desde una etiqueta NFC o una automatización; no duplica si el último se hizo hace menos de 2 min) y `?view=map` abre el mapa (`handleLaunchParams` en `app.js`).
- Cuando se instala un Service Worker nuevo, la página se recarga sola, pero espera a que no haya ningún `<dialog>` abierto ni tareas en `busyTasks` (un cierre que aún se está guardando).
- La instalación del Service Worker descarga el app shell con `cache: 'reload'`: GitHub Pages da 10 min de caché HTTP y, sin eso, la versión nueva se llenaba con archivos antiguos (pasó al desplegar la v2; en local no se ve porque el devserver usa `no-store`). **Tras cada despliegue, probar la actualización en producción con un perfil que tenga la versión anterior.**
- Servicios externos y sus políticas: Nominatim (máx. 1 petición/s, nunca repetir, máx. 5 peticiones por llamada; antes se reutiliza la calle de un aparcamiento a ≤25 m) y teselas de OSM (nada de descargas masivas: la precarga son 19 teselas por aparcamiento y las de menos de 7 días no se vuelven a pedir; la cabecera `Expires` de OSM no sirve para esto porque llega ya caducada, por eso cada tesela se guarda con `x-carcheck-fetched-at`).
- Los avisos del ticket son best effort: sin servidor no hay notificaciones programadas con la app cerrada. No prometer otra cosa en la interfaz.
- Cámara: cualquier fallo de `getUserMedia` activa el modo «cámara del sistema» (`<input capture>`) para ese tipo (foto/vídeo); el input no se abre en el mismo toque porque Chrome puede bloquearlo tras el diálogo de permisos. Se pide con `zoom: true` (permiso PTZ «mover la cámara»); si se deniega solo eso, se reintenta sin zoom.

## Desarrollo y pruebas
- `powershell -ExecutionPolicy Bypass -File tools/dev.ps1` levanta el servidor en `http://localhost:8080` y un túnel de cloudflared que imprime la URL `https://….trycloudflare.com` para abrirla en el móvil.
- Tests unitarios y de IndexedDB: abre `http://localhost:8080/tests/`. Al terminar, la página envía un informe en texto a `POST /__report` del devserver (se escribe en `tools/.test-report`), y así se pueden ejecutar en Chrome headless y leer el resultado desde la terminal.
- Pruebas E2E: Chrome headless controlado por el DevTools Protocol (geolocalización simulada, `--use-fake-device-for-media-stream` para la cámara, `Network.emulateNetworkConditions` para el modo offline). El Wake Lock necesita `Browser.grantPermissions` con `wakeLockScreen`; el zoom se prueba simulando `getCapabilities()`. **El perfil de Chrome tiene que estar en una ruta corta** (p. ej. `%TEMP%\cc-carcheck`): con rutas largas, CacheStorage falla con «Unexpected internal error» y el Service Worker no se instala.
- Herramientas instaladas en Windows: cloudflared (`C:\Program Files (x86)\cloudflared\`), gh (`C:\Program Files\GitHub CLI\`), Python 3.13.

## Pendiente de probar en un móvil real
- Linterna (`torch`), `ImageCapture.takePhoto()`, brújula real y notificaciones del ticket (en headless solo se pueden simular).
- Zoom de la cámara (permiso PTZ en Chrome Android), pantalla encendida con el mapa/brújula, el flujo de cierre con la pantalla bloqueada justo después de pulsar y la etiqueta NFC.

## Propuestas descartadas (y por qué), para no volver a ellas sin motivo
- Badging API (`setAppBadge`): Chrome Android no la admite (en Android el icono solo muestra punto con notificaciones).
- Dictado por voz de la nota: el micrófono del teclado (Gboard) ya lo hace, y la Web Speech API necesita internet (falla justo en el parking). Nota de audio: no compensa cambiar el modelo (`media` es una sola foto/vídeo).
- Battery Status API para recortar el GPS: 20 s de GPS y 19 teselas apenas gastan; no compensa.
- Aviso del ticket con `.ics`/calendario: en Android no hay forma fiable de que se abra en el calendario o el reloj.
- Encender la linterna automáticamente sin GPS: es una suposición; el botón 🔦 ya está a mano.
- Pantalla encendida durante la hoja de cierre: con el móvil en el bolsillo podría tocarse «Descartar».

## Ideas futuras (la arquitectura ya está preparada)
- Exportar e importar en JSON (serializar `records`, `settings` y los blobs en base64). El usuario la descartó en la v2.
- Varios vehículos (`vehicleId` ya existe en cada registro).
- Si algún día hace falta: widget, avisos fiables con la app cerrada o detección por Bluetooth → requieren app nativa (Capacitor). El usuario decidió seguir como web app.
