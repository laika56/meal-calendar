import assert from 'node:assert/strict';
import { cp, link, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  catalogManifest,
  loadReviewedCatalogFiles,
} from '../scripts/validate-franchise-data.mjs';
import {
  applyCatalogImport,
  buildCatalogImportPlan,
  runCatalogImportCli,
} from '../functions/import-franchise-catalog.mjs';
import { normalizeCatalogText } from '../src/lib/franchiseCatalog.js';
import {
  buildMfdsPages,
  canonicalSnapshot,
  collectMfdsSnapshot,
  fetchMfdsPage,
  publicBrandIdForMaker,
  publishCatalogPair,
  reconcilePublicBrands,
  shouldReportMfdsProgress,
  toPublicCatalogRecord,
  validateMfdsPage,
} from '../scripts/build-mfds-franchise-data.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reviewedAt = '2026-08-18T00:00:00.000Z';
const mfdsBrandFixture = JSON.parse(
  await readFile(path.join(projectRoot, 'tests/fixtures/mfds-brand-sample.json'), 'utf8'),
);
const mfdsFranchiseItem = mfdsBrandFixture.cases.franchise_with_weight.items[1];
const mfdsNonFranchiseItem = mfdsBrandFixture.cases.generic_no_maker.items[0];

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

async function withCatalogFixture(change) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'meal-calendar-catalog-'));
  await cp(path.join(projectRoot, 'data'), path.join(fixtureRoot, 'data'), { recursive: true });
  try {
    await change(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function writeFixtureJson(root, relativePath, value) {
  await writeFile(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

async function catalogArtifactNames(destination) {
  const prefix = `.${path.basename(destination)}.`;
  return (await readdir(path.dirname(destination)))
    .filter((name) => name.startsWith(prefix))
    .toSorted();
}

function importFixtureCatalog() {
  return {
    sources: [{
      id: 'source-a', type: 'public_data', name: '출처 A', url: 'https://example.test/source',
      licenseNote: null, checkedAt: reviewedAt, active: true,
    }],
    brands: [{
      id: 'brand-a', name: '브랜드 A', normalizedName: '브랜드 a', aliases: [], category: '테스트',
      officialUrl: null, active: true, createdAt: reviewedAt, updatedAt: reviewedAt,
    }],
    records: [{
      id: 'food-a', brandId: 'brand-a', brandName: '브랜드 A', name: '음식 A', aliases: [],
      normalizedName: '음식 a', searchTokens: ['브랜드 a', '음식 a'], category: '테스트',
      basis: { amount: 100, unit: 'g', label: '100g' },
      nutrients: { kcal: 100, carbG: null, proteinG: null, fatG: null, sugarG: null, sodiumMg: null },
      sourceId: 'source-a', sourceType: 'public_data', sourceUrl: 'https://example.test/source',
      sourceUpdatedAt: null, verifiedAt: reviewedAt, confidence: 'public', active: true,
      createdAt: reviewedAt, updatedAt: reviewedAt,
    }],
  };
}

function clone(value) {
  return structuredClone(value);
}

function importPointer(plan) {
  return {
    runId: plan.runId,
    counts: plan.counts,
    catalogSha256: plan.catalogSha256,
    payloadSha256: plan.payloadSha256,
  };
}

function createFakeFirestore({ initial = {}, failBatch = null, tamperOnVerification = null } = {}) {
  const documents = new Map(Object.entries(initial).map(([key, value]) => [key, clone(value)]));
  let batchCommits = 0;
  let didTamper = false;
  const ref = (path) => ({
    path,
    async get() {
      const data = documents.get(path);
      return { exists: data !== undefined, data: () => clone(data) };
    },
    async set(data) {
      documents.set(path, clone(data));
    },
  });
  const db = {
    doc: ref,
    collection(path) {
      return {
        async get() {
          if (!didTamper && tamperOnVerification) {
            didTamper = true;
            tamperOnVerification(documents);
          }
          const prefix = `${path}/`;
          const docs = [...documents.entries()]
            .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .sort(([left], [right]) => left.localeCompare(right, 'en'))
            .map(([key, value]) => ({ id: key.slice(prefix.length), data: () => clone(value) }));
          return { docs, size: docs.length };
        },
      };
    },
    batch() {
      const pending = [];
      return {
        set(target, data) { pending.push([target.path, clone(data)]); },
        async commit() {
          batchCommits += 1;
          if (batchCommits === failBatch) throw new Error(`simulated batch ${failBatch} failure`);
          for (const [path, data] of pending) documents.set(path, data);
        },
      };
    },
    async runTransaction(callback) {
      const pending = [];
      const transaction = {
        get: (target) => target.get(),
        set: (target, data) => pending.push([target.path, clone(data)]),
      };
      await callback(transaction);
      for (const [path, data] of pending) documents.set(path, data);
    },
  };
  return {
    db,
    documents,
  };
}

function mfdsPage({ pageNo, totalCount, items, numOfRows = 500 }) {
  return {
    header: { resultCode: '00' },
    body: { pageNo, numOfRows, totalCount, items: { item: items } },
  };
}

function mfdsItem(code) {
  return {
    ...mfdsFranchiseItem,
    FOOD_CD: `test-${code}`,
    FOOD_NM_KR: `테스트 메뉴 ${code}`,
  };
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

test('MFDS page plan covers zero, one, exact-boundary, and multi-page result sets', () => {
  assert.deepEqual(buildMfdsPages(0, 500), []);
  assert.deepEqual(buildMfdsPages(1, 500), [1]);
  assert.deepEqual(buildMfdsPages(500, 500), [1]);
  assert.deepEqual(buildMfdsPages(1_001, 500), [1, 2, 3]);
});

test('MFDS pages reject duplicated or shifted identities, wrong row size, and final-page overfill', () => {
  const finalItem = { FOOD_CD: 'final' };
  assert.deepEqual(
    validateMfdsPage(mfdsPage({ pageNo: 3, totalCount: 1_001, items: [finalItem] }), {
      pageNo: 3,
      totalCount: 1_001,
      rowsPerPage: 500,
    }),
    { totalCount: 1_001, items: [finalItem] },
  );
  assert.throws(
    () => validateMfdsPage(mfdsPage({ pageNo: 2, totalCount: 1_001, items: [finalItem] }), {
      pageNo: 3, totalCount: 1_001, rowsPerPage: 500,
    }),
    /pageNo/,
  );
  assert.throws(
    () => validateMfdsPage(mfdsPage({ pageNo: 3, totalCount: 1_001, items: [finalItem], numOfRows: 100 }), {
      pageNo: 3, totalCount: 1_001, rowsPerPage: 500,
    }),
    /numOfRows/,
  );
  assert.throws(
    () => validateMfdsPage(mfdsPage({ pageNo: 3, totalCount: 1_001, items: [finalItem, finalItem] }), {
      pageNo: 3, totalCount: 1_001, rowsPerPage: 500,
    }),
    /expected 1 items/,
  );
  assert.throws(
    () => validateMfdsPage(mfdsPage({ pageNo: 3, totalCount: 1_001, items: Array(500).fill(finalItem) }), {
      pageNo: 3, totalCount: 1_001, rowsPerPage: 500,
    }),
    /expected 1 items/,
  );
  assert.throws(
    () => validateMfdsPage({ header: { resultCode: '00' }, body: { pageNo: 3, numOfRows: 500, totalCount: 1_001, items: 'invalid' } }, {
      pageNo: 3, totalCount: 1_001, rowsPerPage: 500,
    }),
    /unrecognized items shape/,
  );
});

test('MFDS fetch propagates timeout and HTTP errors without exposing the key', async () => {
  let receivedUrl;
  let receivedSignal;
  await assert.rejects(
    () => fetchMfdsPage('encoded%2Fsecret', 1, {
      fetchImpl: async (url, options) => {
        receivedUrl = new URL(url);
        receivedSignal = options.signal;
        throw new Error('request timeout');
      },
    }),
    /request timeout/,
  );
  assert.equal(receivedUrl.searchParams.get('serviceKey'), 'encoded/secret');
  assert.equal(receivedUrl.searchParams.get('pageNo'), '1');
  assert.equal(receivedUrl.searchParams.get('numOfRows'), '500');
  assert.ok(receivedSignal instanceof AbortSignal);
  await assert.rejects(
    () => fetchMfdsPage('key', 1, { fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /HTTP 503/,
  );
});

test('MFDS fetch observes an injected short AbortSignal timeout', async () => {
  let observedAbort = false;
  await assert.rejects(
    () => fetchMfdsPage('key', 1, {
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          observedAbort = true;
          reject(signal.reason);
        }, { once: true });
      }),
    }),
    (error) => error?.name === 'TimeoutError',
  );
  assert.equal(observedAbort, true);
});

test('MFDS collection bounds concurrency and merges completed pages in requested order', async () => {
  const requested = [];
  let active = 0;
  let maximumActive = 0;
  const pages = new Map([
    [1, { totalCount: 5, items: [mfdsItem('a'), mfdsItem('b')] }],
    [2, { totalCount: 5, items: [mfdsItem('c'), mfdsItem('d')] }],
    [3, { totalCount: 5, items: [mfdsItem('e')] }],
  ]);
  const collected = await collectMfdsSnapshot('key', reviewedAt, {
    rowsPerPage: 2,
    concurrency: 2,
    reportProgress: () => {},
    fetchPage: async (_apiKey, pageNo) => {
      requested.push(pageNo);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, pageNo === 2 ? 15 : 1));
      active -= 1;
      return pages.get(pageNo);
    },
  });

  assert.deepEqual(requested, [1, 2, 3]);
  assert.equal(maximumActive, 2);
  assert.deepEqual(collected.records.map(({ id }) => id), [
    'mfds-test-a', 'mfds-test-b', 'mfds-test-c', 'mfds-test-d', 'mfds-test-e',
  ]);
});

test('MFDS publication validates before writes and restores both files after the second replacement fails', async () => {
  await withCatalogFixture(async (fixtureRoot) => {
    const brandsPath = path.join(fixtureRoot, 'data/franchise/brands.json');
    const snapshotPath = path.join(fixtureRoot, 'data/franchise/public/mfds-franchise.json');
    const [brandsBefore, snapshotBefore] = await Promise.all([readFile(brandsPath, 'utf8'), readFile(snapshotPath, 'utf8')]);
    let failSecondCommit = true;
    await assert.rejects(
      () => publishCatalogPair(fixtureRoot, {
        brandsContents: `${JSON.stringify(JSON.parse(brandsBefore), null, 4)}\n`,
        snapshotContents: snapshotBefore,
      }, {
        linkFile: async (from, destination) => {
          if (destination === snapshotPath && failSecondCommit) {
            failSecondCommit = false;
            throw new Error('simulated second replacement failure');
          }
          return link(from, destination);
        },
      }),
      /simulated second replacement failure/,
    );
    assert.equal(await readFile(brandsPath, 'utf8'), brandsBefore);
    assert.equal(await readFile(snapshotPath, 'utf8'), snapshotBefore);

    let validationRenameCalls = 0;
    await assert.rejects(
      () => publishCatalogPair(fixtureRoot, {
        brandsContents: '[]\n',
        snapshotContents: snapshotBefore,
      }, {
        renameFile: async (...args) => {
          validationRenameCalls += 1;
          return rename(...args);
        },
      }),
    );
    assert.equal(validationRenameCalls, 0);
  });
});

test('MFDS successful pair publication leaves exact destinations and no owned sibling debris', async () => {
  await withCatalogFixture(async (fixtureRoot) => {
    const brandsPath = path.join(fixtureRoot, 'data/franchise/brands.json');
    const snapshotPath = path.join(fixtureRoot, 'data/franchise/public/mfds-franchise.json');
    const [brandsBefore, snapshotBefore] = await Promise.all([readFile(brandsPath, 'utf8'), readFile(snapshotPath, 'utf8')]);
    const brandsAfter = `${brandsBefore} \n`;
    const snapshotAfter = `${snapshotBefore} \n`;

    await publishCatalogPair(fixtureRoot, {
      brandsContents: brandsAfter,
      snapshotContents: snapshotAfter,
    });

    assert.equal(await readFile(brandsPath, 'utf8'), brandsAfter);
    assert.equal(await readFile(snapshotPath, 'utf8'), snapshotAfter);
    assert.deepEqual(await catalogArtifactNames(brandsPath), []);
    assert.deepEqual(await catalogArtifactNames(snapshotPath), []);
  });
});

test('MFDS publication preserves concurrent replacements at both destination checkpoints', async () => {
  for (const phaseToInject of ['before-quarantine', 'before-commit']) {
    for (const targetRelativePath of [
      'data/franchise/brands.json',
      'data/franchise/public/mfds-franchise.json',
    ]) {
      await withCatalogFixture(async (fixtureRoot) => {
        const brandsPath = path.join(fixtureRoot, 'data/franchise/brands.json');
        const snapshotPath = path.join(fixtureRoot, 'data/franchise/public/mfds-franchise.json');
        const [brandsBefore, snapshotBefore] = await Promise.all([readFile(brandsPath, 'utf8'), readFile(snapshotPath, 'utf8')]);
        const targetPath = path.join(fixtureRoot, targetRelativePath);
        const foreignContents = `foreign writer owns ${path.basename(targetPath)}\n`;
        await assert.rejects(
          () => publishCatalogPair(fixtureRoot, {
            brandsContents: `${JSON.stringify(JSON.parse(brandsBefore), null, 4)}\n`,
            snapshotContents: snapshotBefore,
          }, {
            onCheckpoint: async ({ phase, destination }) => {
              if (phase === phaseToInject && destination === targetPath) {
                await writeFile(destination, foreignContents, 'utf8');
              }
            },
          }),
          /concurrently changed|foreign/i,
        );
        assert.equal(await readFile(targetPath, 'utf8'), foreignContents);
        assert.equal(await readFile(targetPath === brandsPath ? snapshotPath : brandsPath, 'utf8'), targetPath === brandsPath ? snapshotBefore : brandsBefore);
      });
    }
  }
});

test('MFDS quarantine move restores a foreign write injected inside renameFile', async () => {
  await withCatalogFixture(async (fixtureRoot) => {
    const brandsPath = path.join(fixtureRoot, 'data/franchise/brands.json');
    const snapshotPath = path.join(fixtureRoot, 'data/franchise/public/mfds-franchise.json');
    const [brandsBefore, snapshotBefore] = await Promise.all([readFile(brandsPath, 'utf8'), readFile(snapshotPath, 'utf8')]);
    const foreignBrands = 'foreign writer owns brands inside renameFile\n';
    let injected = false;
    await assert.rejects(
      () => publishCatalogPair(fixtureRoot, {
        brandsContents: `${JSON.stringify(JSON.parse(brandsBefore), null, 4)}\n`,
        snapshotContents: snapshotBefore,
      }, {
        renameFile: async (from, destination) => {
          if (!injected && from === brandsPath) {
            injected = true;
            await writeFile(brandsPath, foreignBrands, 'utf8');
          }
          return rename(from, destination);
        },
      }),
      /foreign concurrent data/i,
    );
    assert.equal(await readFile(brandsPath, 'utf8'), foreignBrands);
    assert.equal(await readFile(snapshotPath, 'utf8'), snapshotBefore);
  });
});

test('MFDS rollback never overwrites a concurrent replacement after second-file commit failure', async () => {
  await withCatalogFixture(async (fixtureRoot) => {
    const brandsPath = path.join(fixtureRoot, 'data/franchise/brands.json');
    const snapshotPath = path.join(fixtureRoot, 'data/franchise/public/mfds-franchise.json');
    const [brandsBefore, snapshotBefore] = await Promise.all([readFile(brandsPath, 'utf8'), readFile(snapshotPath, 'utf8')]);
    const brandsAfter = `${brandsBefore} \n`;
    const snapshotAfter = `${snapshotBefore} \n`;
    const foreignBrands = 'foreign writer owns brands during rollback\n';
    let failSecondCommit = true;
    let failure;
    await assert.rejects(
      () => publishCatalogPair(fixtureRoot, {
        brandsContents: brandsAfter,
        snapshotContents: snapshotAfter,
      }, {
        linkFile: async (from, destination) => {
          if (destination === snapshotPath && failSecondCommit) {
            failSecondCommit = false;
            throw new Error('simulated second commit failure');
          }
          return link(from, destination);
        },
        onCheckpoint: async ({ phase, destination }) => {
          if (phase === 'before-rollback-quarantine' && destination === brandsPath) {
            await writeFile(destination, foreignBrands, 'utf8');
          }
        },
      }),
      (error) => {
        failure = error;
        return /simulated second commit failure.*refused rollback/i.test(error.message);
      },
    );
    assert.equal(await readFile(brandsPath, 'utf8'), foreignBrands);
    assert.equal(await readFile(snapshotPath, 'utf8'), snapshotBefore);
    const brandsRecovery = failure.recoveryArtifacts.find(({ destination }) => destination === brandsPath);
    assert.equal(await readFile(brandsRecovery.old, 'utf8'), brandsBefore);
    assert.equal(await readFile(brandsRecovery.new, 'utf8'), brandsAfter);
  });
});

test('MFDS rollback retains exact old/new recovery copies when either destination changes after restore verification', async () => {
  for (const targetRelativePath of [
    'data/franchise/brands.json',
    'data/franchise/public/mfds-franchise.json',
  ]) {
    await withCatalogFixture(async (fixtureRoot) => {
      const brandsPath = path.join(fixtureRoot, 'data/franchise/brands.json');
      const snapshotPath = path.join(fixtureRoot, 'data/franchise/public/mfds-franchise.json');
      const [brandsBefore, snapshotBefore] = await Promise.all([readFile(brandsPath, 'utf8'), readFile(snapshotPath, 'utf8')]);
      const brandsAfter = `${brandsBefore} \n`;
      const snapshotAfter = `${snapshotBefore} \n`;
      const targetPath = path.join(fixtureRoot, targetRelativePath);
      const foreignContents = `foreign writer owns ${path.basename(targetPath)} after rollback verification\n`;
      let failSecondCommit = true;
      let failure;
      await assert.rejects(
        () => publishCatalogPair(fixtureRoot, {
          brandsContents: brandsAfter,
          snapshotContents: snapshotAfter,
        }, {
          linkFile: async (from, destination) => {
            if (destination === snapshotPath && failSecondCommit) {
              failSecondCommit = false;
              throw new Error('simulated second commit failure');
            }
            return link(from, destination);
          },
          onCheckpoint: async ({ phase, destination }) => {
            if (phase === 'after-rollback-restore-verification' && destination === targetPath) {
              await writeFile(destination, foreignContents, 'utf8');
            }
          },
        }),
        (error) => {
          failure = error;
          return /simulated second commit failure.*recovery artifacts retained/i.test(error.message);
        },
      );
      assert.equal(await readFile(targetPath, 'utf8'), foreignContents);
      assert.equal(
        await readFile(targetPath === brandsPath ? snapshotPath : brandsPath, 'utf8'),
        targetPath === brandsPath ? snapshotBefore : brandsBefore,
      );
      assert.deepEqual(
        failure.recoveryArtifacts.map(({ destination }) => destination),
        [brandsPath, snapshotPath],
      );
      for (const { destination, old: oldPath, new: newPath } of failure.recoveryArtifacts) {
        const expectedOld = destination === brandsPath ? brandsBefore : snapshotBefore;
        const expectedNew = destination === brandsPath ? brandsAfter : snapshotAfter;
        assert.equal(await readFile(oldPath, 'utf8'), expectedOld);
        assert.equal(await readFile(newPath, 'utf8'), expectedNew);
        assert.ok(failure.message.includes(oldPath));
        assert.ok(failure.message.includes(newPath));
      }
    });
  }
});

test('MFDS fetch progress is bounded to safe page-count checkpoints', () => {
  assert.equal(shouldReportMfdsProgress(1, 639), true);
  assert.equal(shouldReportMfdsProgress(24, 639), false);
  assert.equal(shouldReportMfdsProgress(25, 639), true);
  assert.equal(shouldReportMfdsProgress(639, 639), true);
});

test('MFDS brands deterministically generate or reuse a reviewed name or alias without merging makers', async () => {
  const existingBrands = (await readJson('data/franchise/brands.json')).filter(({ id }) => id === 'subway');
  const mcdonalds = toPublicCatalogRecord(mfdsFranchiseItem, reviewedAt);
  const subwayAlias = toPublicCatalogRecord({ ...mfdsFranchiseItem, MAKER_NM: '서브웨이' }, reviewedAt);
  const result = reconcilePublicBrands([mcdonalds, subwayAlias], existingBrands, reviewedAt);

  assert.equal(
    publicBrandIdForMaker(mfdsFranchiseItem.MAKER_NM),
    'mfds-brand-ffd3bb1b019cf849',
  );
  assert.equal(result.records[0].brandId, publicBrandIdForMaker(mfdsFranchiseItem.MAKER_NM));
  assert.equal(result.records[0].brandName, mfdsFranchiseItem.MAKER_NM);
  assert.equal(result.records[1].brandId, 'subway');
  assert.equal(result.records[1].brandName, '써브웨이');
  assert.deepEqual(result.brands.map(({ id }) => id), ['mfds-brand-ffd3bb1b019cf849', 'subway']);
  assert.deepEqual(result.brands[0], {
    id: 'mfds-brand-ffd3bb1b019cf849',
    name: '맥도날드',
    normalizedName: '맥도날드',
    aliases: [],
    category: 'MFDS 프랜차이즈',
    officialUrl: null,
    active: true,
    createdAt: reviewedAt,
    updatedAt: reviewedAt,
  });
  assert.notEqual(publicBrandIdForMaker('맥도날드 코리아'), publicBrandIdForMaker(mfdsFranchiseItem.MAKER_NM));
});

test('MFDS franchise records are strict, stable, and preserve only reviewed values', () => {
  const record = toPublicCatalogRecord(mfdsFranchiseItem, reviewedAt);

  assert.equal(record.id, `mfds-${mfdsFranchiseItem.FOOD_CD}`);
  assert.equal(record.name, mfdsFranchiseItem.FOOD_NM_KR);
  assert.equal(record.brandName, mfdsFranchiseItem.MAKER_NM);
  assert.deepEqual(record.basis, { amount: 100, unit: 'g', label: '100g' });
  assert.deepEqual(record.nutrients, {
    kcal: 261,
    carbG: 22.42,
    proteinG: 12.11,
    fatG: 13.9,
    sugarG: null,
    sodiumMg: null,
  });
  assert.equal(record.sourceId, 'mfds-franchise');
  assert.equal(record.sourceType, 'public_data');
  assert.equal(record.confidence, 'public');
  assert.equal(record.verifiedAt, reviewedAt);
  assert.equal(record.createdAt, reviewedAt);
  assert.equal(record.updatedAt, reviewedAt);
  assert.equal(toPublicCatalogRecord(mfdsNonFranchiseItem, reviewedAt), null);
  assert.equal(toPublicCatalogRecord({ ...mfdsFranchiseItem, MAKER_NM: '   ' }, reviewedAt), null);
  assert.throws(
    () => toPublicCatalogRecord({ ...mfdsFranchiseItem, MAKER_NM: 42 }, reviewedAt),
    /maker must be a string or null/,
  );
  assert.throws(
    () => toPublicCatalogRecord({ ...mfdsFranchiseItem, SERVING_SIZE: '1개' }, reviewedAt),
    /expected SERVING_SIZE/,
  );
  assert.throws(
    () => toPublicCatalogRecord({ ...mfdsFranchiseItem, FOOD_CD: '' }, reviewedAt),
    /FOOD_CD must be a non-empty string/,
  );
});

test('canonical MFDS snapshots reject duplicate codes and order records deterministically', () => {
  const first = toPublicCatalogRecord(mfdsFranchiseItem, reviewedAt);
  const second = { ...first, id: 'mfds-D202-000000000-0001' };
  const metadata = {
    generatedAt: reviewedAt,
    sourceId: 'mfds-franchise',
    sourceManifestSha256: 'a'.repeat(64),
    excludedMissingMaker: 0,
  };

  assert.deepEqual(
    canonicalSnapshot([first, second], metadata).records.map(({ id }) => id),
    [second.id, first.id],
  );
  assert.deepEqual(
    canonicalSnapshot([second, first], metadata),
    canonicalSnapshot([first, second], metadata),
  );
  assert.throws(() => canonicalSnapshot([first, first], metadata), /duplicate catalog record id/);
});

test('validator allows a public-only brand with null officialUrl but refuses an official-brand binding without one', async () => {
  await withCatalogFixture(async (fixtureRoot) => {
    const brands = JSON.parse(await readFile(path.join(fixtureRoot, 'data/franchise/brands.json'), 'utf8'));
    const record = toPublicCatalogRecord(mfdsFranchiseItem, reviewedAt);
    const reconciled = reconcilePublicBrands([record], brands, reviewedAt);
    await writeFixtureJson(fixtureRoot, 'data/franchise/brands.json', reconciled.brands);
    await writeFixtureJson(fixtureRoot, 'data/franchise/public/mfds-franchise.json', canonicalSnapshot(
      reconciled.records,
      {
        generatedAt: reviewedAt,
        sourceId: 'mfds-franchise',
        sourceManifestSha256: 'b'.repeat(64),
        excludedMissingMaker: 0,
      },
    ));
    await loadReviewedCatalogFiles(fixtureRoot);
  });

  await withCatalogFixture(async (fixtureRoot) => {
    const brands = JSON.parse(await readFile(path.join(fixtureRoot, 'data/franchise/brands.json'), 'utf8'));
    const subwayIndex = brands.findIndex(({ id }) => id === 'subway');
    brands[subwayIndex] = { ...brands[subwayIndex], officialUrl: null };
    await writeFixtureJson(fixtureRoot, 'data/franchise/brands.json', brands);
    await assert.rejects(
      () => loadReviewedCatalogFiles(fixtureRoot),
      /official brand subway must have an officialUrl/,
    );
  });
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
  assert.equal(brandsFile[0].id.startsWith('mfds-brand-'), true);
  assert.equal(brandsFile.at(-1).id, 'subway');
  assert.deepEqual(officialFile.map(({ id }) => id), ['subway-menu-1528']);
  assert.ok(isIsoUtcDate(publicFile.generatedAt));
  assert.equal(publicFile.sourceId, 'mfds-franchise');
  assert.match(publicFile.sourceManifestSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(publicFile.excludedMissingMaker));
  assert.ok(publicFile.excludedMissingMaker > 0);
  assert.ok(publicFile.records.length > 0);

  const sourceIds = new Set(sources.map(({ id }) => id));
  const brandById = new Map(brands.map((brand) => [brand.id, brand]));
  assert.equal(sourceIds.size, sources.length);
  assert.equal(brandById.size, brands.length);
  assert.deepEqual([...new Set(records.map(({ id }) => id))].length, records.length);
  assert.ok(records.length > 1);

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
    if (record.sourceType === 'official_brand') {
      assert.ok(record.sourceUrl.startsWith('https://www.subway.co.kr/menuView/sandwich?menuItemIdx='));
    } else {
      assert.equal(record.sourceUrl, 'https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02');
    }
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
  assert.equal(manifest.counts.sources, 2);
  assert.equal(manifest.counts.brands, catalog.brands.length);
  assert.equal(manifest.counts.foods, catalog.records.length);
  assert.equal(manifest.counts.officialRecords, 1);
  assert.equal(manifest.counts.publicRecords, catalog.records.length - 1);
  assert.match(
    result.stdout,
    new RegExp(`^sources 2\\nbrands ${manifest.counts.brands}\\nfoods ${manifest.counts.foods}\\npublicRecords ${manifest.counts.publicRecords}\\ncatalogSha256 ${manifest.sha256}\\nNo issues\\.$`),
  );
  assert.equal(after, before);
});

test('refuses a public snapshot whose declared source is absent from the source registry', async () => {
  await withCatalogFixture(async (fixtureRoot) => {
    const snapshot = await readFile(path.join(fixtureRoot, 'data/franchise/public/mfds-franchise.json'), 'utf8');
    await writeFixtureJson(fixtureRoot, 'data/franchise/public/mfds-franchise.json', {
      ...JSON.parse(snapshot),
      sourceId: 'unknown-public-source',
    });

    await assert.rejects(
      () => loadReviewedCatalogFiles(fixtureRoot),
      /public snapshot references unknown source unknown-public-source/,
    );
  });
});

test('refuses public records that do not use the public snapshot source', async () => {
  await withCatalogFixture(async (fixtureRoot) => {
    const [sources, officialRecords, snapshot] = await Promise.all([
      JSON.parse(await readFile(path.join(fixtureRoot, 'data/franchise/sources.json'), 'utf8')),
      JSON.parse(await readFile(path.join(fixtureRoot, 'data/franchise/official/subway.json'), 'utf8')),
      JSON.parse(await readFile(path.join(fixtureRoot, 'data/franchise/public/mfds-franchise.json'), 'utf8')),
    ]);
    const secondPublicSource = {
      ...sources[0],
      id: 'another-public-source',
      name: '다른 공공데이터 출처',
    };
    const mismatchedPublicRecord = {
      ...officialRecords[0],
      id: 'mfds-mismatched-source',
      sourceId: secondPublicSource.id,
      sourceType: 'public_data',
      sourceUrl: secondPublicSource.url,
      confidence: 'public',
    };
    await writeFixtureJson(fixtureRoot, 'data/franchise/sources.json', [secondPublicSource, ...sources]);
    await writeFixtureJson(fixtureRoot, 'data/franchise/public/mfds-franchise.json', {
      ...snapshot,
      records: [mismatchedPublicRecord],
    });

    await assert.rejects(
      () => loadReviewedCatalogFiles(fixtureRoot),
      /public record mfds-mismatched-source sourceId must match public snapshot sourceId mfds-franchise/,
    );
  });
});

test('refuses an official source domain that is not the referenced brand official domain', async () => {
  await withCatalogFixture(async (fixtureRoot) => {
    const [sources, officialRecords] = await Promise.all([
      JSON.parse(await readFile(path.join(fixtureRoot, 'data/franchise/sources.json'), 'utf8')),
      JSON.parse(await readFile(path.join(fixtureRoot, 'data/franchise/official/subway.json'), 'utf8')),
    ]);
    const foreignUrl = 'https://example.test/menu/1528';
    const sourceIndex = sources.findIndex(({ id }) => id === 'subway-menu-1528');
    sources[sourceIndex] = { ...sources[sourceIndex], url: foreignUrl };
    officialRecords[0] = { ...officialRecords[0], sourceUrl: foreignUrl };
    await writeFixtureJson(fixtureRoot, 'data/franchise/sources.json', sources);
    await writeFixtureJson(fixtureRoot, 'data/franchise/official/subway.json', officialRecords);

    await assert.rejects(
      () => loadReviewedCatalogFiles(fixtureRoot),
      /official record subway-menu-1528 source domain must match brand subway officialUrl domain/,
    );
  });
});

test('catalog import plan creates a deterministic first-run staging snapshot without mutating reviewed input', () => {
  const catalog = importFixtureCatalog();
  const before = clone(catalog);
  const plan = buildCatalogImportPlan(null, catalog);

  assert.equal(plan.runId, `franchise-catalog-${plan.catalogSha256}`);
  assert.equal(plan.unchanged, false);
  assert.deepEqual(plan.counts, { sources: 1, brands: 1, foods: 1 });
  assert.equal(plan.catalogSha256, catalogManifest(catalog).sha256);
  assert.equal(plan.documents[0].path, `franchiseCatalogRuns/${plan.runId}/sources/source-a`);
  assert.equal(plan.documents.at(-1).path, `franchiseCatalogRuns/${plan.runId}/foods/food-a`);
  assert.equal(plan.run.data.status, 'staging');
  assert.deepEqual(catalog, before);
});

test('catalog import plan is a no-op only when the entire reviewed manifest matches current', () => {
  const catalog = importFixtureCatalog();
  const firstPlan = buildCatalogImportPlan(null, catalog);
  const unchangedPlan = buildCatalogImportPlan({ ...importPointer(firstPlan), publishedAt: reviewedAt }, catalog);
  const changedCatalog = clone(catalog);
  changedCatalog.sources[0].name = '바뀐 출처';
  const changedPlan = buildCatalogImportPlan(importPointer(firstPlan), changedCatalog);

  assert.equal(unchangedPlan.unchanged, true);
  assert.deepEqual(unchangedPlan.batches, []);
  assert.equal(changedPlan.unchanged, false);
  assert.notEqual(changedPlan.runId, firstPlan.runId);
});

test('catalog import plan keeps run IDs and staging batches stable and within 400 writes', async () => {
  const catalog = await loadReviewedCatalogFiles(projectRoot);
  const first = buildCatalogImportPlan(null, catalog);
  const second = buildCatalogImportPlan(null, clone(catalog));

  assert.equal(first.runId, second.runId);
  assert.deepEqual(first.batches, second.batches);
  assert.ok(first.batches.every((batch) => batch.length > 0 && batch.length <= 400));
  assert.deepEqual(first.documents.slice(0, 2).map(({ path: documentPath }) => documentPath), [
    `franchiseCatalogRuns/${first.runId}/sources/mfds-franchise`,
    `franchiseCatalogRuns/${first.runId}/sources/subway-menu-1528`,
  ]);
});

test('catalog import plan refuses duplicate staging IDs before any Firestore write can be planned', () => {
  const catalog = importFixtureCatalog();
  catalog.records.push(clone(catalog.records[0]));

  assert.throws(() => buildCatalogImportPlan(null, catalog), /duplicate food id food-a/);
});

test('catalog import promotes only a reread and canonically verified staged snapshot', async () => {
  const plan = buildCatalogImportPlan(null, importFixtureCatalog());
  const { db, documents } = createFakeFirestore();

  await applyCatalogImport(db, plan, { now: () => reviewedAt });

  assert.equal(documents.get(`franchiseCatalogRuns/${plan.runId}`).status, 'ready');
  assert.deepEqual(documents.get('franchiseCatalogState/current'), {
    ...importPointer(plan), publishedAt: reviewedAt,
  });
});

test('catalog import leaves only an unreferenced staging run when a middle batch fails', async () => {
  const catalog = importFixtureCatalog();
  for (let index = 0; index < 500; index += 1) {
    catalog.records.push({ ...clone(catalog.records[0]), id: `food-${index}`, name: `음식 ${index}`, normalizedName: `음식 ${index}`, searchTokens: [`음식 ${index}`] });
  }
  const plan = buildCatalogImportPlan(null, catalog);
  const { db, documents } = createFakeFirestore({ failBatch: 2 });

  await assert.rejects(() => applyCatalogImport(db, plan), /simulated batch 2 failure/);

  assert.equal(documents.get(`franchiseCatalogRuns/${plan.runId}`).status, 'staging');
  assert.equal(documents.has('franchiseCatalogState/current'), false);
});

test('catalog import leaves a verified staging run unreferenced when the preflight pointer drifts', async () => {
  const initialPlan = buildCatalogImportPlan(null, importFixtureCatalog());
  const changedCatalog = importFixtureCatalog();
  changedCatalog.sources[0].name = '새 출처';
  const plan = buildCatalogImportPlan(importPointer(initialPlan), changedCatalog);
  const { db, documents } = createFakeFirestore({
    initial: {
      'franchiseCatalogState/current': { runId: 'concurrent-run', counts: { sources: 0, brands: 0, foods: 0 }, catalogSha256: 'a'.repeat(64), payloadSha256: 'b'.repeat(64) },
    },
  });

  await assert.rejects(() => applyCatalogImport(db, plan), /pointer changed since preflight/);

  assert.equal(documents.get(`franchiseCatalogRuns/${plan.runId}`).status, 'staging');
  assert.equal(documents.get('franchiseCatalogState/current').runId, 'concurrent-run');
});

test('catalog import rejects a reread staging hash mismatch before changing the pointer', async () => {
  const plan = buildCatalogImportPlan(null, importFixtureCatalog());
  const { db, documents } = createFakeFirestore({
    tamperOnVerification(store) {
      const path = `franchiseCatalogRuns/${plan.runId}/foods/food-a`;
      store.set(path, { ...store.get(path), name: '오염된 음식' });
    },
  });

  await assert.rejects(() => applyCatalogImport(db, plan), /staged payload hash mismatch/);

  assert.equal(documents.get(`franchiseCatalogRuns/${plan.runId}`).status, 'staging');
  assert.equal(documents.has('franchiseCatalogState/current'), false);
});

test('catalog import rejects a reread staging count mismatch before changing the pointer', async () => {
  const plan = buildCatalogImportPlan(null, importFixtureCatalog());
  const { db, documents } = createFakeFirestore({
    tamperOnVerification(store) {
      store.delete(`franchiseCatalogRuns/${plan.runId}/foods/food-a`);
    },
  });

  await assert.rejects(() => applyCatalogImport(db, plan), /staged document count mismatch/);

  assert.equal(documents.get(`franchiseCatalogRuns/${plan.runId}`).status, 'staging');
  assert.equal(documents.has('franchiseCatalogState/current'), false);
});

test('catalog importer defaults to a read-only dry run', async () => {
  const { db, documents } = createFakeFirestore();
  const output = [];

  const result = await runCatalogImportCli({
    firestore: db,
    args: [],
    write: (line) => output.push(line),
  });

  assert.equal(result.status, 'dry-run');
  assert.equal(documents.size, 0);
  assert.match(output.join(''), /mode dry-run/);
  assert.match(output.join(''), /sources 2\nbrands 126\nfoods 16342/);
});
