// Service worker: cache aset statis + terima notifikasi push
const CACHE = 'bm-v20';
const ASSETS = [
  'index.html', 'app.html', 'css/base.css', 'css/themes.css', 'css/fx.css', 'icon.svg', 'manifest.json',
  'icons/icon-192.png', 'icons/badge-96.png',
  'js/app.js', 'js/auth.js', 'js/config.js', 'js/currency.js', 'js/state.js', 'js/supabase.js', 'js/theme.js',
  'js/ui.js', 'js/date.js', 'js/db.js', 'js/fx.js', 'js/push.js',
  'js/modules/home.js', 'js/modules/settings.js', 'js/modules/settings-notif.js', 'js/modules/placeholder.js', 'js/modules/todo.js',
  'js/modules/todo-schedule.js', 'js/modules/habit.js', 'js/modules/sleep.js', 'js/modules/gym.js', 'js/modules/finance.js', 'js/modules/salary.js',
  'js/modules/invest.js', 'js/modules/wishlist.js', 'js/modules/target.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
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

// ---------- Notifikasi ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() }; }
  const base = self.registration.scope;
  e.waitUntil(self.registration.showNotification(d.title || 'Better Me', {
    body: d.body || '',
    icon: base + 'icons/icon-192.png',
    badge: base + 'icons/badge-96.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || base + 'app.html' }
  }));
});

// Tap notifikasi → buka app di halaman terkait (pakai jendela yang sudah terbuka kalau ada)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope + 'app.html';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        try { await w.navigate(url); } catch { w.postMessage({ type: 'navigate', url }); }
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

// Langganan diperbarui otomatis oleh browser → minta app mendaftarkan ulang saat dibuka
self.addEventListener('pushsubscriptionchange', () => {});
