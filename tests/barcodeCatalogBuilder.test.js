import test from 'node:test';
import assert from 'node:assert/strict';

import { withBoundedTimeoutRetry } from '../scripts/build-barcode-catalog.mjs';

test('retries only timeouts with a fixed cap and reports each retry', async () => {
  let calls = 0;
  const retries = [];
  const result = await withBoundedTimeoutRetry(async () => {
    calls += 1;
    if (calls < 3) throw new DOMException('timed out', 'TimeoutError');
    return 'ok';
  }, { onRetry: (attempt) => retries.push(attempt) });
  assert.equal(result, 'ok');
  assert.deepEqual(retries, [1, 2]);
  let wrappedCalls = 0;
  assert.equal(await withBoundedTimeoutRetry(async () => {
    wrappedCalls += 1;
    if (wrappedCalls === 1) throw new Error('MFDS response is malformed: The operation was aborted due to timeout');
    return 'wrapped-ok';
  }), 'wrapped-ok');
  await assert.rejects(withBoundedTimeoutRetry(async () => { throw new Error('shape'); }), /shape/);
  await assert.rejects(withBoundedTimeoutRetry(async () => {
    throw new DOMException('timed out', 'TimeoutError');
  }), /timed out/);
});
