"""Servidor estático para desarrollo.

Se usa en lugar de `python -m http.server` por dos motivos:
- En Windows, los tipos MIME salen del registro y a veces `.js` se sirve como
  text/plain, y entonces el navegador se niega a cargar los ES modules.
- `Cache-Control: no-store` evita que la caché HTTP enmascare los cambios
  mientras se desarrolla. El Service Worker se versiona aparte.
"""

import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as server:
        print(f"Sirviendo {os.path.abspath(ROOT)} en http://localhost:{PORT}")
        server.serve_forever()
