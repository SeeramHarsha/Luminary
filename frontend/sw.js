'use strict';
// Luminary service worker: app shell + saved media work fully offline.
const VERSION = 'v3';
const SHELL = 'lm-shell-' + VERSION;
const MEDIA = 'lm-media'; // survives updates; managed by the page (download / prune)
const DATA = 'lm-data';
const ASSETS = ['/', '/app.css', '/app.js', '/player.js', '/admin.js', '/manifest.webmanifest', '/fonts/outfit.woff2', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/sparkle.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lm-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  if (r.mode === 'navigate') return e.respondWith(navigate(e));
  if (u.pathname.startsWith('/media/') || u.pathname === '/brand/logo') return e.respondWith(media(r, u));
  if (u.pathname === '/api/catalog' || u.pathname === '/api/me') return e.respondWith(networkFirst(r));
  if (u.pathname.startsWith('/api/')) return;
  e.respondWith(staleWhileRevalidate(e, r));
});

// Any page URL (/, /q/CODE) opens the cached app shell instantly; it refreshes in the background.
async function navigate(e) {
  const c = await caches.open(SHELL);
  const hit = await c.match('/');
  const net = fetch('/', { cache: 'no-cache' }).then((res) => { if (res.ok) c.put('/', res.clone()); return res; });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net.catch(() => new Response('Offline', { status: 503 }));
}

async function staleWhileRevalidate(e, r) {
  const c = await caches.open(SHELL);
  const hit = await c.match(r, { ignoreSearch: true });
  const net = fetch(r, { cache: 'no-cache' }).then((res) => { if (res.ok) c.put(r, res.clone()); return res; });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

async function networkFirst(r) {
  const c = await caches.open(DATA);
  try {
    const res = await Promise.race([fetch(r), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]);
    if (res.ok) c.put(r, res.clone());
    return res;
  } catch {
    const hit = await c.match(r);
    return hit || new Response('{"error":"offline"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

// Saved media is keyed by path and served with Range support so <video> can seek offline.
async function media(r, u) {
  const c = await caches.open(MEDIA);
  const hit = await c.match(u.pathname);
  if (hit) return r.headers.has('range') ? sliceRange(r, hit) : hit;
  const res = await fetch(r);
  if (res.status === 200 && (res.headers.get('Content-Type') || '').startsWith('image/')) c.put(u.pathname, res.clone());
  return res;
}

async function sliceRange(req, res) {
  const blob = await res.blob();
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  let start = 0;
  let end = size - 1;
  if (m) {
    if (m[1] === '') start = Math.max(0, size - Number(m[2]));
    else { start = Number(m[1]); if (m[2] !== '') end = Math.min(Number(m[2]), size - 1); }
  }
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'video/mp4',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}
