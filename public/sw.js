// 앱 셸만 캐싱한다. 영양 데이터는 Firestore가 오프라인 퍼시스턴스로 알아서 한다.
// ARCHITECTURE.md 「오프라인」 참조.
// 이 값은 tests/shellFiles.test.js 가 SHELL_FILES 의 실제 bytes 전체와 대조한다.
// 셸 파일을 바꾸고 이 digest를 갱신하지 않으면 테스트가 실패한다. 서비스워커 자체가
// 바뀌어야 새 install이 실행되므로, 검색 UI 같은 새 배포가 구형 cache에 가리는 일을 막는다.
const SHELL_REVISION = 'd7d3a6fa43a18ff1f6c622e7141a98b8be14c60552ded6e37a4a6b8074102fc4';
const CACHE_NAME = `meal-calendar-shell-${SHELL_REVISION}`;

// app.js / db.js 가 실제로 import 하는 것을 전부 적는다.
// 하나라도 빠지면 오프라인에서 앱이 아예 안 뜬다 (절대규칙 6).
//
// **이 목록은 tests/shellFiles.test.js 가 실제 import 와 대조한다.**
// 2026-08-14 에 roulette·servingEstimate·weightTrend 가 몇 시간 동안 빠져 있었다 —
// 온라인에선 멀쩡해 보여서 아무도 몰랐고, 새 배포가 사용자에게 안 닿는 원인이기도 했다.
// 주석으로 「잊지 말자」고 적어두는 것으론 안 잡힌다. 그래서 테스트로 옮겼다.
const SHELL_FILES = [
  '/',
  '/public/index.html',
  '/public/app.js',
  '/public/barcodeOcr.js',
  '/public/barcodePhoto.js',
  '/public/barcodeLookupFlow.js',
  '/public/nutritionLabelOcr.js',
  '/public/db.js',
  '/public/partialNutritionEntry.js',
  '/public/searchResult.js',
  '/public/searchStatus.js',
  '/public/searchSelectionGate.js',
  '/public/manifest.webmanifest',
  '/public/icon-192.png',
  '/public/icon-512.png',
  '/src/firebaseConfig.js',
  '/src/lib/authMessages.js',
  '/src/lib/authValidation.js',
  '/src/lib/calendarGrid.js',
  '/src/lib/dayTotals.js',
  '/src/lib/dataTransfer.js',
  '/src/lib/entryRevision.js',
  '/src/lib/metabolism.js',
  '/src/lib/multiCandidate.js',
  '/src/lib/myBarcodeCache.js',
  '/src/lib/nutritionLabel.js',
  '/src/lib/nutritionLabelCamera.js',
  '/src/lib/mfdsParser.js',
  '/src/lib/offParser.js',
  '/src/lib/barcodeProduct.js',
  '/src/lib/quickFoodInput.js',
  '/src/lib/presetV2.js',
  '/src/lib/searchFoodsResponse.js',
  '/src/lib/uiDashboard.js',
  '/src/lib/roulette.js',
  '/src/lib/servingEstimate.js',
  '/src/lib/units.js',
  '/src/lib/weightTrend.js',
  '/src/lib/weeklySummary.js',
  // 1인분 참고표. 필요할 때만 fetch 하지만 오프라인에서도 참고값이 떠야 한다
  '/src/data/servingByCategory.json',
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

function cacheable(response) {
  // opaque(cors 아닌 외부) 와 오류 응답은 넣지 않는다. 용량만 먹고 판정도 못 한다.
  return response && response.ok && response.type === 'basic';
}

// stale-while-revalidate.
//
// 왜 network-first 가 아닌가: network-first 는 매 실행마다 셸 전체(≈95KB)를 네트워크에서
// 다시 받는다. 캐시는 오프라인 폴백으로만 쓰여서 PWA 인데 캐시 이점이 0이었고, 실기기에서
// 「불러오는 데 오래 걸린다」로 나타났다 (2026-08-13).
//
// 왜 cache-first 도 아닌가: 그건 이 프로젝트가 이미 겪은 버그다 — 재배포해도 브라우저가
// 헌 버전을 계속 썼다. SWR 은 캐시를 즉시 돌려주면서 뒤에서 네트워크로 갱신하므로
// 빠르면서도 다음 실행에는 새 버전이 뜬다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 외부 출처(gstatic 의 Firebase SDK, Firestore 통신)는 건드리지 않는다.
  // Firestore 는 자체 오프라인 퍼시스턴스가 있어서 SW 가 끼어들 이유가 없다.
  if (url.origin !== self.location.origin) return;

  // Cloud Functions 프록시는 캐싱하지 않는다. firebase.json 의 rewrite 때문에
  // same-origin 으로 보이지만 인증이 붙은 동적 응답이다 — 캐시에 남기면 로그아웃 뒤에도
  // 남고, 다른 계정이 같은 응답을 받을 수 있다.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (cacheable(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch((err) => {
          // 캐시된 응답을 이미 돌려준 뒤라면 오프라인은 정상 상황이다.
          // 캐시가 없었다면 이 거부가 그대로 호출부로 간다 — 삼키지 않는다.
          if (cached) return cached;
          throw err;
        });

      // 캐시가 있으면 즉시 돌려주고, 갱신은 뒤에서 계속 돈다.
      return cached || network;
    }),
  );
});
