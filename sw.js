// Service worker sederhana: cache aset statis, data selalu dari Supabase (network)
const CACHE = 'bm-v4';
const ASSETS = [
  'index.html', 'app.html', 'css/base.css', 'css/themes.css', 'css/fx.css', 'js/fx.js', 'icon.svg', 'manifest.json',
  'js/app.js', 'js/auth.js', 'js/config.js', 'js/currency.js', 'js/state.js',
  'js/supabase.js', 'js/theme.js', 'js/ui.js', 'js/date.js', 'js/modules/todo.js',
  'js/modules/home.js', 'js/modules/settings.js', 'js/modules/placeholder.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Network-first untuk file sendiri (biar update langsung kepakai), fallback ke cache saat offline
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});
