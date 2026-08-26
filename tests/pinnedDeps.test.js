import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { comparePinnedDeps, extractCdnPins } from '../src/lib/pinnedDeps.js';

const T = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
const T8 = 'https://cdn.jsdelivr.net/npm/tesseract.js@8.0.0/dist/tesseract.esm.min.js';
const Tloose = 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.esm.min.js';
const Z = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.3/reader/index.js';
const S = 'https://unpkg.com/@scope/pkg@1.2.3/x.js';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('extractCdnPins extracts a scoped unpkg package', () => {
  assert.deepEqual(extractCdnPins(S), [
    {
      url: S,
      package: '@scope/pkg',
      version: '1.2.3',
    },
  ]);
});

test('extractCdnPins sorts pins by simple URL string order', () => {
  assert.deepEqual(
    extractCdnPins(`${Z}\n${T}`).map((pin) => pin.package),
    ['tesseract.js', 'zxing-wasm'],
  );
});

test('extractCdnPins returns an empty array when no supported CDN URL exists', () => {
  assert.deepEqual(extractCdnPins(''), []);
  assert.deepEqual(
    extractCdnPins('https://cdn.example.com/npm/x@1.0.0/y.js'),
    [],
  );
});

test('extractCdnPins rejects non-string sources', () => {
  assert.throws(() => extractCdnPins(null), TypeError);
  assert.throws(() => extractCdnPins(123), TypeError);
});

test('comparePinnedDeps accepts empty input and matching exact pins', () => {
  assert.deepEqual(comparePinnedDeps([]), { ok: true, problems: [] });
  assert.deepEqual(
    comparePinnedDeps([
      { name: 'a.js', source: T },
      { name: 'b.js', source: T },
    ]),
    { ok: true, problems: [] },
  );
});

test('comparePinnedDeps reports version mismatches', () => {
  assert.deepEqual(
    comparePinnedDeps([
      { name: 'a.js', source: T },
      { name: 'b.js', source: T8 },
    ]),
    {
      ok: false,
      problems: [
        {
          package: 'tesseract.js',
          kind: 'version-mismatch',
          versions: ['7.0.0', '8.0.0'],
        },
      ],
    },
  );
});

test('comparePinnedDeps reports loose versions with sorted file occurrences', () => {
  assert.deepEqual(
    comparePinnedDeps([
      { name: 'b.js', source: Tloose },
      { name: 'a.js', source: `${Tloose}\n${Tloose}` },
    ]),
    {
      ok: false,
      problems: [
        {
          package: 'tesseract.js',
          kind: 'unpinned',
          version: '7',
          files: ['a.js', 'a.js', 'b.js'],
        },
      ],
    },
  );
});

test('comparePinnedDeps accepts multiple exact packages and scoped packages', () => {
  assert.deepEqual(
    comparePinnedDeps([{ name: 'a.js', source: `${T}\n${Z}` }]),
    { ok: true, problems: [] },
  );
  assert.deepEqual(comparePinnedDeps([{ name: 'a.js', source: S }]), {
    ok: true,
    problems: [],
  });
});

test('comparePinnedDeps accepts sources without supported CDN URLs', () => {
  assert.deepEqual(
    comparePinnedDeps([{ name: 'a.js', source: 'const x=1;' }]),
    { ok: true, problems: [] },
  );
});

test('comparePinnedDeps reports unpinned and mismatch problems independently', () => {
  assert.deepEqual(
    comparePinnedDeps([
      { name: 'b.js', source: T8 },
      { name: 'a.js', source: Tloose },
    ]),
    {
      ok: false,
      problems: [
        {
          package: 'tesseract.js',
          kind: 'unpinned',
          version: '7',
          files: ['a.js'],
        },
        {
          package: 'tesseract.js',
          kind: 'version-mismatch',
          versions: ['7', '8.0.0'],
        },
      ],
    },
  );
});

test('comparePinnedDeps rejects non-array entries', () => {
  assert.throws(() => comparePinnedDeps(null), TypeError);
  assert.throws(() => comparePinnedDeps('x'), TypeError);
});

test('all public JavaScript CDN dependencies are pinned consistently', () => {
  const publicDir = join(projectRoot, 'public');
  const entries = readdirSync(publicDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => ({
      name: entry.name,
      source: readFileSync(join(publicDir, entry.name), 'utf8'),
    }));

  const result = comparePinnedDeps(entries);
  assert.strictEqual(
    result.ok,
    true,
    `CDN pin problems: ${JSON.stringify(result.problems)}`,
  );
});
