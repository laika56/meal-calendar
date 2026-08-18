import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFile = promisify(execFileCallback);

test('exported searchFoods uses its production auth, catalog, MFDS, and cache defaults for a valid request', async () => {
  const { stdout } = await execFile(process.execPath, [
    '--experimental-test-module-mocks',
    'tests/fixtures/verifyDefaultSearchFoodsWiring.mjs',
  ], { cwd: process.cwd() });

  assert.match(stdout, /default searchFoods wiring: PASS/);
});
