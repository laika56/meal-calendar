import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// `hosting.public` 이 `.` 이라 **ignore 에 안 적힌 것은 전부 배포된다.** 화이트리스트가
// 아니라 블랙리스트다. 2026-08-26 실측에서 브라우저가 한 번도 안 쓰는 것들이 나가고 있었다:
//   /data/franchise/public/mfds-franchise.json  13,039,209B (12.4MB)
//   /package.json · /package-lock.json          의존성 목록
// 폴더가 새로 생길 때마다 사람이 기억해서 막는 건 안 된다. 그래서 테스트로 잠근다.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
const read = (p) => readFileSync(join(root, p), 'utf8');

test('배포에서 제외해야 할 것이 ignore 에 있다', () => {
  const ignore = config.hosting.ignore;
  for (const pattern of ['data/**', 'package.json', 'package-lock.json', 'functions/**', 'tests/**', 'docs/**']) {
    assert.ok(ignore.includes(pattern), `hosting.ignore 에 ${pattern} 이 없다 — 배포본에 나간다`);
  }
});

test('ignore 한 data/ 를 브라우저 코드가 참조하지 않는다', () => {
  // 막았는데 실제로 쓰고 있으면 배포본만 404 가 된다. 로컬 테스트로는 안 잡히는 사고다.
  const sources = ['public/app.js', 'public/db.js', 'public/sw.js', 'public/index.html']
    .filter((p) => existsSync(join(root, p)))
    .map((p) => ({ p, s: read(p) }));

  for (const { p, s } of sources) {
    const hits = [...s.matchAll(/['"`](\/data\/[^'"`]*)['"`]/g)].map((m) => m[1]);
    assert.deepEqual(hits, [], `${p} 가 ignore 된 /data/ 를 참조한다`);
  }
});

test('앱을 깨뜨리지 않는 보안 헤더 4개가 모든 경로에 붙는다', () => {
  // CSP 는 일부러 뺐다 — 필요한 출처가 gstatic·jsdelivr·googleapis·openfoodfacts·
  // blob:·wasm-unsafe-eval 로 넓어서 잘못 쓰면 앱이 통째로 죽는다. 별도 작업이다.
  const rule = config.hosting.headers.find((h) => h.source === '**');
  assert.ok(rule, "hosting.headers 에 source '**' 규칙이 없다");

  const got = Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));
  assert.equal(got['X-Content-Type-Options'], 'nosniff');
  assert.equal(got['X-Frame-Options'], 'DENY');
  assert.equal(got['Referrer-Policy'], 'strict-origin-when-cross-origin');

  // 카메라 앱이다. self 는 반드시 살리고, 나머지 권한은 닫는다.
  const permissions = got['Permissions-Policy'];
  assert.ok(permissions, 'Permissions-Policy 가 없다 — 카메라 권한이 열린 채다');
  assert.match(permissions, /camera=\(self\)/, '카메라를 self 로 허용하지 않으면 스캔이 죽는다');
  for (const closed of ['microphone', 'geolocation', 'payment']) {
    assert.match(permissions, new RegExp(`${closed}=\\(\\)`), `${closed} 를 닫지 않았다`);
  }
});
