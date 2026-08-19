#!/usr/bin/env node
// public/sw.js 의 SHELL_REVISION 을 현재 앱 셸 bytes 로 다시 계산한다.
//
// **왜 스크립트가 있나:** SHELL_FILES 에 든 파일을 하나라도 고치면
// tests/shellFiles.test.js 가 빨간다. 그때마다 해시를 손으로 계산해 붙여넣었는데,
// 2026-08-19 하루에만 네 번 반복했다. 계산식은 테스트와 **완전히 같아야** 하므로
// 손으로 하면 언젠가 어긋난다.
//
// 계산식은 tests/shellFiles.test.js 의 currentShellRevision() 과 같다:
//   sha256( 각 경로에 대해 `${경로}\0${바이트길이}\0` + 바이트 )
//
// 사용: node scripts/bump-shell-revision.mjs [--check]
//   --check 를 주면 고치지 않고 어긋났는지만 알린다(exit 1).
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'public/sw.js');
const source = readFileSync(swPath, 'utf8');

const listMatch = source.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
if (!listMatch) {
  console.error('SHELL_FILES 목록을 못 찾았다 — sw.js 구조가 바뀌었나?');
  process.exit(2);
}
const paths = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const currentMatch = source.match(/const SHELL_REVISION = '([0-9a-f]+)'/);
if (!currentMatch) {
  console.error("SHELL_REVISION 을 못 찾았다 — sw.js 구조가 바뀌었나?");
  process.exit(2);
}

const hash = createHash('sha256');
for (const path of paths) {
  // 루트('/')는 rewrite 로 index.html 이 뜬다 — 테스트와 같은 규칙이다.
  const filePath = join(root, path === '/' ? 'public/index.html' : path.slice(1));
  const bytes = readFileSync(filePath);
  hash.update(`${path}\0${bytes.length}\0`);
  hash.update(bytes);
}
const next = hash.digest('hex');
const current = currentMatch[1];

if (current === next) {
  console.log(`SHELL_REVISION 최신 (${paths.length}개 파일, ${next.slice(0, 12)}…)`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  console.error(`SHELL_REVISION 이 낡았다: ${current.slice(0, 12)}… → ${next.slice(0, 12)}…`);
  console.error('고치려면: node scripts/bump-shell-revision.mjs');
  process.exit(1);
}

writeFileSync(swPath, source.replace(current, next));
console.log(`SHELL_REVISION ${current.slice(0, 12)}… → ${next.slice(0, 12)}… (${paths.length}개 파일)`);
