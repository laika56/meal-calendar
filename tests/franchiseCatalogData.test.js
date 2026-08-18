import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  catalogManifest,
  loadReviewedCatalogFiles,
} from '../scripts/validate-franchise-data.mjs';
import { normalizeCatalogText } from '../src/lib/franchiseCatalog.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reviewedAt = '2026-08-18T00:00:00.000Z';

function pick(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function isIsoUtcDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), 'utf8'));
}

test('Subway BMT is bound to the reviewed Korean official page', async () => {
  const { records } = await loadReviewedCatalogFiles(projectRoot);
  const bmt = records.find(({ id }) => id === 'subway-menu-1528');

  assert.deepEqual(
    pick(bmt, ['brandName', 'name', 'basis', 'nutrients', 'sourceUrl']),
    {
      brandName: '써브웨이',
      name: '이탈리안 비엠티',
      basis: { amount: 228, unit: 'g', label: '1인분' },
      nutrients: {
        kcal: 388, carbG: null, proteinG: 21, fatG: null, sugarG: 8.6, sodiumMg: 1064,
      },
      sourceUrl: 'https://www.subway.co.kr/menuView/sandwich?menuItemIdx=1528',
    },
  );
  assert.equal(bmt.verifiedAt, reviewedAt);
});

test('checked-in registries and records are canonical, connected, and only contain reviewed nutrients', async () => {
  const [sourcesFile, brandsFile, officialFile, publicFile] = await Promise.all([
    readJson('data/franchise/sources.json'),
    readJson('data/franchise/brands.json'),
    readJson('data/franchise/official/subway.json'),
    readJson('data/franchise/public/mfds-franchise.json'),
  ]);
  const { sources, brands, records } = await loadReviewedCatalogFiles(projectRoot);

  assert.deepEqual(sourcesFile.map(({ id }) => id), ['mfds-franchise', 'subway-menu-1528']);
  assert.deepEqual(brandsFile.map(({ id }) => id), ['subway']);
  assert.deepEqual(officialFile.map(({ id }) => id), ['subway-menu-1528']);
  assert.deepEqual(publicFile, {
    generatedAt: null,
    sourceId: 'mfds-franchise',
    sourceManifestSha256: null,
    records: [],
  });

  const sourceIds = new Set(sources.map(({ id }) => id));
  const brandById = new Map(brands.map((brand) => [brand.id, brand]));
  assert.equal(sourceIds.size, sources.length);
  assert.equal(brandById.size, brands.length);
  assert.deepEqual([...new Set(records.map(({ id }) => id))].length, records.length);
  assert.deepEqual(records.map(({ id }) => id), ['subway-menu-1528']);

  const aliases = new Set();
  for (const brand of brands) {
    assert.equal(brand.normalizedName, normalizeCatalogText(brand.name));
    assert.ok(isIsoUtcDate(brand.createdAt));
    assert.ok(isIsoUtcDate(brand.updatedAt));
    for (const alias of brand.aliases) {
      const normalized = normalizeCatalogText(alias);
      assert.equal(alias, normalized);
      assert.ok(!aliases.has(normalized), `duplicate normalized brand alias ${normalized}`);
      aliases.add(normalized);
    }
  }

  for (const source of sources) {
    assert.ok(isIsoUtcDate(source.checkedAt));
    assert.ok(['apis.data.go.kr', 'www.subway.co.kr'].includes(new URL(source.url).hostname));
  }

  for (const record of records) {
    const source = sources.find(({ id }) => id === record.sourceId);
    const brand = brandById.get(record.brandId);
    assert.ok(sourceIds.has(record.sourceId));
    assert.ok(brand);
    assert.equal(record.brandName, brand.name);
    assert.equal(record.sourceType, source.type);
    assert.equal(new URL(record.sourceUrl).hostname, new URL(source.url).hostname);
    assert.ok(record.sourceUrl.startsWith('https://www.subway.co.kr/menuView/sandwich?menuItemIdx='));
    assert.equal(record.sourceUpdatedAt, null);
    assert.ok(isIsoUtcDate(record.verifiedAt));
    assert.ok(isIsoUtcDate(record.createdAt));
    assert.ok(isIsoUtcDate(record.updatedAt));
  }

  const bmt = records.find(({ id }) => id === 'subway-menu-1528');
  assert.deepEqual(bmt.nutrients, {
    kcal: 388, carbG: null, proteinG: 21, fatG: null, sugarG: 8.6, sodiumMg: 1064,
  });
});

test('catalog manifest is deterministic and the validator reports the reviewed bootstrap catalog without writes', async () => {
  const catalog = await loadReviewedCatalogFiles(projectRoot);
  const manifest = catalogManifest(catalog);
  const before = await readFile(path.join(projectRoot, 'data/franchise/public/mfds-franchise.json'), 'utf8');
  const result = spawnSync(process.execPath, ['scripts/validate-franchise-data.mjs'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  const after = await readFile(path.join(projectRoot, 'data/franchise/public/mfds-franchise.json'), 'utf8');

  assert.equal(result.status, 0, result.stderr);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.counts, {
    sources: 2, brands: 1, foods: 1, officialRecords: 1, publicRecords: 0,
  });
  assert.match(
    result.stdout,
    new RegExp(`^sources 2\\nbrands 1\\nfoods 1\\npublicRecords 0\\ncatalogSha256 ${manifest.sha256}\\nNo issues\\.$`),
  );
  assert.equal(after, before);
});
