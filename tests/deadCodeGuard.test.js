import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('phase 1 test-runner scaffold is removed after real tests exist', () => {
  assert.equal(existsSync(join(root, 'tests/harness.test.js')), false);
});

test('unused future database exports are absent', () => {
  const source = read('public/db.js');

  assert.doesNotMatch(source, /export async function loadAllGoals\b/);
  assert.doesNotMatch(source, /export async function addDislike\b/);
});

test('environment example only documents variables consumed by tracked code', () => {
  const source = read('.env.example');

  assert.doesNotMatch(source, /^ANTHROPIC_API_KEY=/m);
  assert.doesNotMatch(source, /^OFF_USER_AGENT=/m);
});

test('there is only one shell revision update command', () => {
  assert.equal(existsSync(join(root, 'scripts/sync-shell-revision.mjs')), false);
  assert.equal(existsSync(join(root, 'scripts/bump-shell-revision.mjs')), true);
});
