/**
 * 只快取「殼」（HTML/CSS/JS/圖示），資料一律走網路。
 * 這樣離線時 App 仍打得開，記帳會先進 outbox，連線後由 app.js 補送。
 */
const CACHE = 'pennycount-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './api.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (key) {
          return key === CACHE ? null : caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  // 後端 API 不快取，避免看到過期的帳
  if (request.url.indexOf('script.google.com') !== -1) return;

  event.respondWith(
    caches.match(request).then(function (cached) {
      const network = fetch(request)
        .then(function (response) {
          if (response && response.ok && request.url.startsWith(self.location.origin)) {
            const copy = response.clone();
            caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
          }
          return response;
        })
        .catch(function () { return cached; });
      return cached || network;
    })
  );
});
