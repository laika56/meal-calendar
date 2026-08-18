import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 서비스워커의 SHELL_FILES 가 실제 import 와 어긋나면 **오프라인에서 앱이 안 뜬다.**
// 그런데 온라인에선 멀쩡해 보여서 눈으로는 절대 안 잡힌다 —
// 2026-08-14 에 세 파일이 몇 시간 동안 빠져 있었다. 그래서 테스트로 잠근다.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function importedPaths(source) {
  // `from '/src/lib/foo.js'` 와 `import('/public/db.js')` 를 둘 다 잡는다
  return [...source.matchAll(/from\s+'(\/[^']+)'|import\('(\/[^']+)'\)/g)]
    .map((m) => m[1] ?? m[2]);
}

function shellFiles(source) {
  const block = source.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
  assert.ok(block, 'sw.js 에서 SHELL_FILES 를 찾지 못했다');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function shellRevision(source) {
  const match = source.match(/const SHELL_REVISION = '([a-f0-9]{64})';/);
  assert.ok(match, 'sw.js 에서 SHA-256 SHELL_REVISION 을 찾지 못했다');
  return match[1];
}

function currentShellRevision(paths) {
  const hash = createHash('sha256');
  for (const path of paths) {
    const filePath = path === '/' ? 'public/index.html' : path.slice(1);
    const bytes = readFileSync(join(root, filePath));
    hash.update(`${path}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

test('서비스워커 셸 목록이 app.js 의 모든 import 를 담고 있다', () => {
  const listed = new Set(shellFiles(read('public/sw.js')));
  const missing = importedPaths(read('public/app.js')).filter((p) => !listed.has(p));

  assert.deepEqual(missing, [], `sw.js SHELL_FILES 에 빠진 import: ${missing.join(', ')}`);
});

test('서비스워커 셸 목록이 db.js 의 모든 로컬 import 를 담고 있다', () => {
  const listed = new Set(shellFiles(read('public/sw.js')));
  // db.js 는 Firebase SDK 를 외부(gstatic)에서 받는다 — 그건 SW 가 안 건드리므로 제외된다
  const missing = importedPaths(read('public/db.js')).filter((p) => !listed.has(p));

  assert.deepEqual(missing, [], `sw.js SHELL_FILES 에 빠진 import: ${missing.join(', ')}`);
});

test('셸 목록에 적힌 파일이 실제로 저장소에 있다', () => {
  const missing = shellFiles(read('public/sw.js'))
    .filter((p) => p !== '/') // 루트는 rewrite 로 index.html 이 뜬다
    .filter((p) => { try { read(p.slice(1)); return false; } catch { return true; } });

  assert.deepEqual(missing, [], `sw.js 에 적혔지만 파일이 없다: ${missing.join(', ')}`);
});

test('서비스워커 캐시 identity가 현재 앱 셸 bytes 전체에 결속된다', () => {
  const source = read('public/sw.js');
  const listed = shellFiles(source);

  assert.match(
    source,
    /const CACHE_NAME = `meal-calendar-shell-\$\{SHELL_REVISION\}`;/,
    'CACHE_NAME 은 SHELL_REVISION 을 실제 cache identity로 사용해야 한다',
  );
  assert.equal(
    shellRevision(source),
    currentShellRevision(listed),
    '앱 셸이 바뀌었는데 SHELL_REVISION 이 갱신되지 않아 이전 캐시가 계속 제공된다',
  );
});
