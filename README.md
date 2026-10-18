# 🚗 CarCheck

**App:** https://jofrecv.github.io/carcheck/ · **Código:** https://github.com/JofreCV/carcheck

App web instalable (PWA) para el móvil que resuelve dos dudas de siempre:

1. **«¿He cerrado el coche?»** Al aparcar pulsas **🔒 Coche cerrado** y queda guardada la hora, la ubicación GPS y, si quieres, una **foto** o un **vídeo de 5 segundos** (por ejemplo, tirando de la manija) y una nota («planta -2, plaza 47»). Cuando te entre la duda en casa, abres la app y ves al momento «Cerrado ✅ hace 2 h 14 min · Carrer Major 12, Tarragona» con la prueba.
2. **«¿Dónde he dejado el coche?»** La vista de mapa muestra el coche, tu posición y la distancia, con un botón **Cómo llegar** que abre Google Maps con la ruta a pie, una **brújula** que apunta al coche y la opción de **compartir** la ubicación. El mapa de la zona se descarga al aparcar, así que funciona aunque vuelvas sin datos.

Todo se guarda **solo en tu móvil** (IndexedDB). No hay servidor ni cuentas, y funciona **sin conexión**.

> Plataforma objetivo: **Chrome en Android**. En iPhone puede funcionar en parte, pero de momento no está soportado oficialmente.

## Funcionalidades

- Registro de cierre con GPS de alta precisión: se queda con la mejor lectura y avisa si la precisión es peor de 50 m. En un parking subterráneo sin señal usa tu última ubicación conocida (marcada como aproximada); si no hay nada, guarda el registro sin coordenadas.
- **Calle real** («Carrer Major 12, Tarragona») en vez de coordenadas, gracias a Nominatim de OpenStreetMap. Si guardas sin conexión, la busca más tarde.
- Prueba visual opcional, sin salir de la app: **foto** (comprimida a ~1280 px) o **vídeo** (cámara trasera, máx. 5 s, cuenta atrás y parada manual), con **linterna** para parkings oscuros. Si no se puede usar la cámara en la app, se usa la del sistema.
- Estado actual siempre visible, con miniatura; al tocarla, la foto o el vídeo se abren a pantalla completa.
- **«Lo he recogido»**: marca que ya no está aparcado (con «Deshacer»), para que la app no siga mostrando un sitio antiguo.
- **Ticket de zona azul**: indica hasta qué hora vale y verás una cuenta atrás («quedan 25 min»), en naranja si queda poco y en rojo si ha caducado. Avisa 10 minutos antes y al caducar, pero solo si la app sigue abierta o en segundo plano (sin servidor no se pueden programar avisos con la app cerrada).
- Mapa con OpenStreetMap: tu posición, la distancia, la ruta a pie en Google Maps, la **brújula** hacia el coche y el botón **Compartir** (WhatsApp, Telegram…). La zona del coche se descarga al aparcar para poder verla sin datos móviles.
- Historial con fecha, calle, miniatura, cuánto tiempo estuvo aparcado y opciones de editar (nota y ticket) y borrar.
- Gestión del espacio: pide al navegador que no borre los datos, muestra el espacio usado y conserva solo las fotos y vídeos de los últimos N registros (10 por defecto, configurable). De los registros antiguos se mantienen los datos y la miniatura.
- Accesos directos al mantener pulsado el icono: «Coche cerrado» y «¿Dónde está mi coche?».

## Cómo está organizado el código

HTML, CSS y JavaScript sin frameworks ni build step: los archivos que hay en el repo son exactamente los que se sirven. La única dependencia es [Leaflet](https://leafletjs.com/) 1.9.4, copiada en `vendor/leaflet/` para que el mapa funcione offline.

- **`index.html`**: el «app shell». Contiene las tres vistas (Inicio, Mapa, Historial), la barra inferior, la hoja «Registrar cierre» y los diálogos: cámara, editar registro, brújula y visor a pantalla completa. Todo está en una sola página y la navegación solo muestra y oculta secciones.
- **`css/styles.css`**: estilos mobile-first con botones grandes y el botón principal abajo, al alcance del pulgar. Los colores se definen como variables en `:root` y se redefinen con `prefers-color-scheme: dark`, así que el modo oscuro es automático.
- **`js/app.js`**: el punto de entrada y orquestador. Conecta los botones con los módulos y contiene los flujos completos: abrir la hoja y lanzar el GPS, hacer la foto o el vídeo, guardar, marcar como recogido, editar, avisos del ticket, buscar direcciones, entrar y salir del mapa, brújula, compartir, borrar del historial y registrar el Service Worker.
- **`js/ui.js`**: todo lo que pinta en pantalla: tarjeta de estado, estado del GPS en la hoja, vista previa de la prueba, cámara, visor, diálogo de edición, brújula, historial, panel del mapa, almacenamiento y toasts (con botón «Deshacer»). No guarda datos ni llama a APIs del dispositivo.
- **`js/format.js`**: funciones puras de formato («hace 2 h 14 min», «quedan 25 min», «1,2 km», «3,4 MB», el texto para compartir…). Están separadas para poder testearlas.
- **`js/model.js`**: el modelo de datos de un registro. Lleva `schemaVersion` (ahora 2) y una tabla de migraciones: los registros guardados con la v1 se actualizan solos al leerlos, sin perder nada. También decide si un registro sigue «aparcado» y qué archivos borrar por la retención.
- **`js/storage.js`**: un wrapper propio y mínimo sobre IndexedDB con tres almacenes: `records` (datos + miniatura), `media` (fotos y vídeos, separados para que el historial cargue rápido) y `settings`. Guarda el registro y su archivo en una sola transacción y, si el almacenamiento está lleno, vuelve a intentarlo sin el archivo. También gestiona `navigator.storage.persist()` y `estimate()`.
- **`js/location.js`**: la geolocalización. Escucha varias lecturas con `enableHighAccuracy` y se queda con la más precisa (para a ±20 m o a los 20 s). Si no hay señal, recurre a la última ubicación conocida. Traduce los errores (permiso denegado, sin señal, timeout) y calcula la distancia (haversine) y el rumbo hasta el coche.
- **`js/media.js`**: la cámara dentro de la app. Hace la foto con `ImageCapture` (o el fotograma de la vista previa) y la comprime con canvas, graba el vídeo con `MediaRecorder` (≤720p, ~1 Mbps, formato detectado con `isTypeSupported`, parada automática a los 5 s), controla la linterna, procesa lo que llega de la cámara del sistema y genera las miniaturas.
- **`js/map.js`**: el mapa con Leaflet: marcador del coche, punto azul de tu posición con su círculo de precisión, encuadre automático y enlace de Google Maps. Se carga con `import()` solo al abrir el mapa, para que la pantalla principal arranque más rápido.
- **`js/geocode.js`**: convierte las coordenadas en una calle con Nominatim. Es el único módulo que envía datos a un servicio externo y respeta su política de uso: como mucho una petición por segundo, sin repetirla nunca (el resultado se guarda) y sin peticiones masivas.
- **`js/compass.js`**: lee la brújula del móvil (`deviceorientationabsolute`) para que la flecha apunte al coche. Si el dispositivo no tiene brújula, la flecha se dibuja con el norte arriba.
- **`js/offline-tiles.js`**: calcula qué teselas del mapa rodean al coche y, al aparcar, descarga 19 (la zona de alrededor a nivel de calle) para poder ver el mapa sin datos. No usa Leaflet, así que no hay que cargar el mapa para hacerlo.
- **`sw.js`**: el Service Worker. Sirve el app shell desde la caché (cache-first), así que la app abre al instante y sin cobertura. Las teselas del mapa van primero a la red; se guarda una copia de las últimas 300 vistas y de la zona del coche para verlas offline. También abre la app al tocar un aviso del ticket.
- **`manifest.webmanifest`** e **`icons/`**: lo que hace que Chrome ofrezca instalar la app (nombre, colores, iconos y accesos directos).
- **`tests/`**: tests que se ejecutan en el propio navegador (abre `tests/index.html`), sin node.
- **`tools/`**: utilidades de desarrollo. `devserver.py` es un servidor local con los tipos MIME correctos; `dev.ps1` lo arranca junto a un túnel HTTPS de cloudflared para probar en el móvil.

## Desarrollo

```powershell
powershell -ExecutionPolicy Bypass -File tools/dev.ps1
```

Arranca el servidor en `http://localhost:8080` y muestra una URL `https://….trycloudflare.com` para abrirla en el móvil. El GPS y la cámara exigen HTTPS, y el túnel lo da con un certificado válido.

Al cambiar cualquier archivo del app shell hay que subir `CACHE_VERSION` en `sw.js`; si no, los móviles que ya tienen la app instalada seguirán usando la versión antigua.

## Despliegue

La app se publica con **GitHub Pages** desde la rama `main` (carpeta raíz) en https://jofrecv.github.io/carcheck/. No hay build: cada `git push` a `main` publica la versión nueva en uno o dos minutos. GitHub Pages sirve por HTTPS, que es obligatorio para el GPS, la cámara y el Service Worker.

## Instalarla en Android

1. Abre la URL de la app en **Chrome**.
2. Acepta los permisos de **ubicación** y **cámara** cuando te los pida (la primera vez que registres un cierre).
3. Pulsa el menú **⋮** → **Instalar aplicación** (o **Añadir a pantalla de inicio**). A veces Chrome muestra directamente un aviso «Instalar CarCheck».
4. Abre CarCheck desde el icono. Funciona como una app más, también sin conexión.

Consejo: instalarla ayuda a que Chrome conceda el almacenamiento persistente, así los datos no se borran aunque el móvil se quede sin espacio. Lo puedes comprobar en Historial → Almacenamiento.

## Privacidad

Los registros, fotos y vídeos se quedan solo en tu móvil. Lo único que sale de él son las coordenadas de cada aparcamiento, que se envían a los servidores de OpenStreetMap (Nominatim) para saber la calle, y las peticiones normales de las teselas del mapa.

## iPhone

De momento la app está pensada para Android. En Safari se puede añadir con **Compartir → Añadir a pantalla de inicio**, pero no se han adaptado las limitaciones de iOS (grabación de vídeo, cuotas de almacenamiento, permisos), así que algunas partes pueden fallar.
