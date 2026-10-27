// Kanban service worker: just enough for Chrome to offer "Install app", plus an offline page.
// It caches nothing. Only page navigations are handled; /api/*, /auth/*, the live stream and every
// other request go straight to the network untouched.
'use strict'

const OFFLINE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#F4EFE6"><title>KANBAN</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F4EFE6;color:#1d1d1b;font:400 14px/1.55 "Space Mono",ui-monospace,Menlo,Consolas,monospace;padding:16px;box-sizing:border-box}
main{width:min(100%,480px);border-top:6px solid #1d1d1b;padding-top:22px;display:grid;gap:16px}
h1{margin:0;font-size:clamp(28px,7vw,40px);line-height:1;letter-spacing:-.03em;text-transform:uppercase}
p{margin:0}
a{color:inherit;font-weight:700;font-size:12px;letter-spacing:.14em;text-transform:uppercase;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:5px;display:inline-block;padding:6px 0}
a:hover{text-decoration-color:#F15060}
a:focus-visible{outline:3px solid #0078BF;outline-offset:3px}
</style></head>
<body><main><h1>Kanban is offline</h1><p>Reconnect and reload.</p><p><a href="">Reload</a></p></main></body></html>`

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.mode !== 'navigate' || req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return
  event.respondWith(fetch(req).catch(() => new Response(OFFLINE, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      'Cache-Control': 'no-store'
    }
  })))
})
