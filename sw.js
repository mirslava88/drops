// sw.js — сервис-воркер: кешируем оболочку приложения, чтобы оно открывалось
// мгновенно и работало при плохой связи. Запросы к API карт идут в сеть.

const CACHE = 'drops-nav-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/geo.js',
  './js/routing.js',
  './js/nav.js',
  './js/voice.js',
  './js/instructions.js',
  './js/storage.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Только свои файлы кешируем; маршруты/геокодер всегда из сети.
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
