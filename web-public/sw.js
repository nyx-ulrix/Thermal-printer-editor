/*
 * Label editor service worker: exists so Chrome offers "Install". It caches nothing.
 * Only page navigations are handled (network first, a small offline page if the
 * network is down); /api/*, /auth/*, assets and everything else go straight to the
 * network untouched.
 */

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Label editor is offline</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #ffffff; color: #121212;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 0 16px; }
  @media (prefers-color-scheme: dark) { body { background: #121212; color: #f2f2f2; } }
  main { max-width: 28rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: 0; opacity: .75; }
</style>
</head>
<body>
<main>
  <h1>Label editor is offline</h1>
  <p>Reconnect and reload.</p>
</main>
</body>
</html>`

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.mode !== 'navigate') return
  const path = new URL(request.url).pathname
  if (path.startsWith('/api/') || path.startsWith('/auth/')) return
  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(OFFLINE_HTML, {
          status: 503,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
            'Cache-Control': 'no-store'
          }
        })
    )
  )
})
