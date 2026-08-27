// sw.js 의 SHELL_REVISION 을 현재 앱 셸 bytes 로 다시 계산해 써넣는다.
//
// 왜 있나 (2026-08-27): 셸 파일을 하나라도 고치면 `tests/shellFiles.test.js` 가 실패한다.
// 그때마다 실패 출력에서 기대 해시를 눈으로 긁어 붙였는데, 한 세션에서 세 번 하다가
// **두 번은 잘못 긁었다**(앞에 `-` 가 붙거나 빈 문자열이 들어갔다).
// 계산식이 테스트 안에만 있어서 그랬다 — 같은 계산을 여기서도 한다.
//
// 계산식이 바뀌면 **두 곳을 같이 고친다.** 어긋나면 이 스크립트가 테스트를 못 통과시킨다.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'public/sw.js');
const source = readFileSync(swPath, 'utf8');

const block = source.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
if (!block) {
  console.error('❌ sw.js 에서 SHELL_FILES 를 찾지 못했다');
  process.exit(1);
}
const paths = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const hash = createHash('sha256');
for (const path of paths) {
  const bytes = readFileSync(join(root, path === '/' ? 'public/index.html' : path.slice(1)));
  hash.update(`${path}\0${bytes.length}\0`);
  hash.update(bytes);
}
const revision = hash.digest('hex');

const current = source.match(/const SHELL_REVISION = '([^']*)';/);
if (!current) {
  console.error('❌ sw.js 에서 SHELL_REVISION 줄을 찾지 못했다');
  process.exit(1);
}
if (current[1] === revision) {
  console.log(`✅ 이미 최신이다 (${revision.slice(0, 12)}…, 셸 ${paths.length}개)`);
  process.exit(0);
}
writeFileSync(swPath, source.replace(
  /const SHELL_REVISION = '[^']*';/,
  `const SHELL_REVISION = '${revision}';`,
));
console.log(`✅ ${current[1].slice(0, 12) || '(빈 값)'}… → ${revision.slice(0, 12)}…  (셸 ${paths.length}개)`);
