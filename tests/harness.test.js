/**
 * 테스트 하네스 자체가 동작하는지 확인한다.
 *
 * 로직 테스트가 아니다. `npm test` 가 실제로 뭔가를 돌리고 있다는 것과,
 * 의존성 없이 ESM import 가 되는 것만 잠근다.
 * Phase 2 에서 실제 테스트가 들어오면 이 파일은 지워도 된다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node:test 러너가 돈다', () => {
  assert.equal(1 + 1, 2);
});

test('ESM import 가 된다 (빌드 스텝 없음)', async () => {
  const { readFile } = await import('node:fs/promises');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.type, 'module');
});

test('실패가 실제로 실패로 보고된다', () => {
  // 통과하는 테스트만으로는 러너가 살아있는지 알 수 없다.
  // 일부러 던지고 잡아서, 어서션이 진짜 동작하는지 확인한다.
  assert.throws(() => assert.equal(1, 2));
});
