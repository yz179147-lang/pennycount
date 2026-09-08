/**
 * 只快取「殼」（HTML/CSS/JS/圖示），資料一律走網路。
 * 這樣離線時 App 仍打得開，記帳會先進 outbox，連線後由 app.js 補送。
 */
const CACHE = 'pennycount-v3';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './theme-boot.js',
  './api.js',
  './charts.js',
  './app.js',
  './categories.js',
  './stats.js',
  './boot.js',
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

  /**
   * 只接管「介面本身」的靜態檔。
   * 任何帶 query string 的請求（也就是 API 呼叫）都直接放行給網路，
   * 否則會拿到上一次的統計數字，而且不管後端架在哪個網域都一樣。
   */
  const url = new URL(request.url);
  const isStatic = url.origin === self.location.origin &&
    !url.search &&
    (url.pathname.endsWith('/') || /\.(?:html|css|js|png|svg|webmanifest|ico)$/.test(url.pathname));
  if (!isStatic) return;

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
