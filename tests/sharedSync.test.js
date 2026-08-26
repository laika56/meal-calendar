import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { compareSharedModules } from '../src/lib/sharedSync.js';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedDir = join(projectRoot, 'functions', 'shared');
const sourceDir = join(projectRoot, 'src', 'lib');

test('빈 목록에는 동기화 문제가 없다', () => {
  assert.deepEqual(compareSharedModules([]), {
    ok: true,
    entries: [],
    problems: [],
  });
});

test('원소 한 개의 동일한 소스를 same으로 판정한다', () => {
  assert.deepEqual(
    compareSharedModules([{ name: 'only.js', appSource: 'x', functionsSource: 'x' }]),
    {
      ok: true,
      entries: [{ name: 'only.js', status: 'same' }],
      problems: [],
    },
  );
});

test('양쪽 빈 파일은 same이지만 null인 쪽은 missing으로 판정한다', () => {
  const report = compareSharedModules([
    { name: 'empty.js', appSource: '', functionsSource: '' },
    { name: 'missing-app.js', appSource: null, functionsSource: '' },
    { name: 'missing-functions.js', appSource: '', functionsSource: null },
    { name: 'missing-both.js', appSource: null, functionsSource: null },
  ]);

  assert.deepEqual(report, {
    ok: false,
    entries: [
      { name: 'empty.js', status: 'same' },
      { name: 'missing-app.js', status: 'missing-app' },
      { name: 'missing-both.js', status: 'missing-both' },
      { name: 'missing-functions.js', status: 'missing-functions' },
    ],
    problems: [
      { name: 'missing-app.js', status: 'missing-app' },
      { name: 'missing-both.js', status: 'missing-both' },
      { name: 'missing-functions.js', status: 'missing-functions' },
    ],
  });
});

test('맨 앞의 BOM 한 글자만 무시한다', () => {
  const report = compareSharedModules([
    { name: 'leading.js', appSource: '\uFEFFcode', functionsSource: 'code' },
    { name: 'middle.js', appSource: `co\uFEFFde`, functionsSource: 'code' },
  ]);

  assert.deepEqual(report.entries, [
    { name: 'leading.js', status: 'same' },
    { name: 'middle.js', status: 'drift' },
  ]);
});

test('CRLF와 단독 CR을 LF로 바꿔 비교한다', () => {
  const report = compareSharedModules([{
    name: 'line-endings.js',
    appSource: 'a\r\nb\rc\n',
    functionsSource: 'a\nb\nc\n',
  }]);

  assert.equal(report.ok, true);
  assert.equal(report.entries[0].status, 'same');
});

test('파일 끝의 여러 LF와 끝 개행이 없는 소스를 같게 본다', () => {
  const report = compareSharedModules([{
    name: 'trailing-lines.js',
    appSource: 'code\n\n',
    functionsSource: 'code',
  }]);

  assert.equal(report.entries[0].status, 'same');
});

test('들여쓰기, 끝 공백, 주석 차이는 drift로 남긴다', () => {
  const report = compareSharedModules([
    { name: 'indent.js', appSource: '  code', functionsSource: ' code' },
    { name: 'space.js', appSource: 'code ', functionsSource: 'code' },
    { name: 'comment.js', appSource: 'code // a', functionsSource: 'code // b' },
  ]);

  assert.equal(report.ok, false);
  assert.deepEqual(report.problems, [
    { name: 'comment.js', status: 'drift' },
    { name: 'indent.js', status: 'drift' },
    { name: 'space.js', status: 'drift' },
  ]);
});

test('이름을 localeCompare가 아닌 단순 문자열 비교 순서로 정렬한다', () => {
  const report = compareSharedModules([
    { name: 'z.js', appSource: 'q', functionsSource: 'q' },
    { name: 'a.js', appSource: 'q', functionsSource: 'q' },
    { name: 'Z.js', appSource: null, functionsSource: 'q' },
  ]);

  assert.deepEqual(report.entries, [
    { name: 'Z.js', status: 'missing-app' },
    { name: 'a.js', status: 'same' },
    { name: 'z.js', status: 'same' },
  ]);
  assert.deepEqual(report.problems, [
    { name: 'Z.js', status: 'missing-app' },
  ]);
});

test('functions/shared의 모든 JavaScript 사본이 src/lib 원본과 일치한다', () => {
  const entries = readdirSync(sharedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map(({ name }) => {
      const sourcePath = join(sourceDir, name);

      return {
        name,
        appSource: existsSync(sourcePath) ? readFileSync(sourcePath, 'utf8') : null,
        functionsSource: readFileSync(join(sharedDir, name), 'utf8'),
      };
    });
  const report = compareSharedModules(entries);

  assert.equal(
    report.ok,
    true,
    `공유 모듈 문제: ${JSON.stringify(report.problems)}`,
  );
});
