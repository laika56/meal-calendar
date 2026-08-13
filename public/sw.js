// 앱 셸만 캐싱한다. 영양 데이터는 Firestore가 오프라인 퍼시스턴스로 알아서 한다.
// ARCHITECTURE.md 「오프라인」 참조.
const CACHE_NAME = 'meal-calendar-shell-v3';
const SHELL_FILES = [
  '/',
  '/public/index.html',
  '/public/app.js',
  '/public/manifest.webmanifest',
  '/public/icon-192.png',
  '/public/icon-512.png',
  '/src/lib/calendarGrid.js',
  '/src/lib/metabolism.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
    )),
  );
  self.clients.claim();
});

// network-first — 개발 중인 앱 셸이 배포해도 안 바뀌는 문제를 피한다.
// 온라인이면 항상 최신을 받고, 응답이 오면 캐시를 갱신한다. 오프라인일 때만 캐시로 폴백한다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
