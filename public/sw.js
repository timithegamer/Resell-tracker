// Service Worker: macht die App installierbar und startet die Oberfläche
// auch bei schlechtem Netz. Daten kommen immer frisch von Supabase.
const CACHE = 'resell-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest',
  'vendor/supabase-2.117.1.js', 'vendor/qrcode-2.0.4.mjs',
  'js/app.js', 'js/config.js', 'js/store.js', 'js/ui.js', 'js/shared.js', 'js/inventory.js', 'js/article.js',
  'js/haul.js', 'js/stats.js', 'js/account.js', 'js/labels.js', 'js/prompts.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Erst Netz (damit Updates sofort da sind), bei Funkloch aus dem Cache.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
