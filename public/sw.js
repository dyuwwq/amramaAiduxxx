// Network-first: сначала свежие файлы из сети, кэш — только если нет интернета.
// При каждом обновлении сайта увеличивай номер версии (v5 -> v6 и т.д.).
const CACHE = 'aidux-v5';
const ASSETS = ['./', './index.html', './map.html', './map.js', './places.css', './ar-nav.html', './vr.html',
  './ai-chat.html', './about.html', './contact.html', './style.css', './ai-chat.css', './ai-chat.js', './manifest.webmanifest'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE)
    // allSettled: отсутствие одного файла не ломает установку
    .then(c => Promise.allSettled(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })))))
    .then(() => self.skipWaiting())
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return; // API не кэшируем
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(r => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
