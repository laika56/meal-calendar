import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDataGoUrl,
  measureSource,
  normalizeDataGoPage,
  parseMeasurementArgs,
} from '../scripts/measure-barcode-sources.mjs';

const pages = new Map([
  [1, {
    pageNo: 1,
    totalCount: 3,
    rows: [
      {
        BARCODE: '8800000000000', NAME: '제품 A', MAKER: '업체 A', SERVING: '80g',
        KCAL: '100', CARB: '10', PROTEIN: '5', FAT: '4',
      },
      {
        BARCODE: '08800000000006', NAME: '제품 B', MAKER: '', SERVING: '',
        KCAL: '200', CARB: '', PROTEIN: '', FAT: '', EXTRA: 'kept-as-field-name-only',
      },
    ],
  }],
  [2, {
    pageNo: 2,
    totalCount: 3,
    rows: [
      {
        BARCODE: '96385074', NAME: '', MAKER: '', SERVING: '',
        KCAL: '', CARB: '', PROTEIN: '', FAT: '',
      },
    ],
  }],
]);

function projectRow(row) {
  return {
    barcode: row.BARCODE,
    name: row.NAME,
    maker: row.MAKER,
    serving: row.SERVING,
    kcal: row.KCAL,
    carbG: row.CARB,
    proteinG: row.PROTEIN,
    fatG: row.FAT,
    dimensions: { makerState: row.MAKER ? 'present' : 'missing' },
  };
}

test('measures every expected page and returns a deterministic secret-free profile', async () => {
  const calls = [];
  const profile = await measureSource({
    sourceId: 'fixture',
    pageSize: 2,
    projectRow,
    async fetchPage(pageNo) {
      calls.push(pageNo);
      return pages.get(pageNo);
    },
  });

  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(profile, {
    sourceId: 'fixture',
    totalRows: 3,
    pageCount: 2,
    fieldPresence: {
      BARCODE: 3, CARB: 3, EXTRA: 1, FAT: 3, KCAL: 3,
      MAKER: 3, NAME: 3, PROTEIN: 3, SERVING: 3,
    },
    barcodeLengths: { 8: 1, 13: 1, 14: 1 },
    dimensionValues: { makerState: { missing: 2, present: 1 } },
    missing: {
      barcode: 0, name: 1, maker: 2, serving: 2,
      kcal: 1, carbG: 2, proteinG: 2, fatG: 2,
    },
  });
});

test('refuses a shifted or duplicated page identity before reporting a profile', async () => {
  await assert.rejects(
    measureSource({
      sourceId: 'fixture',
      pageSize: 2,
      projectRow,
      async fetchPage(pageNo) {
        const page = pages.get(pageNo);
        return pageNo === 2 ? { ...page, pageNo: 1 } : page;
      },
    }),
    /fixture: expected page 2, received 1/,
  );
});

test('refuses missing rows when aggregate count does not match the declared total', async () => {
  await assert.rejects(
    measureSource({
      sourceId: 'fixture',
      pageSize: 2,
      projectRow,
      async fetchPage(pageNo) {
        const page = pages.get(pageNo);
        return pageNo === 2 ? { ...page, rows: [] } : page;
      },
    }),
    /fixture: page 2 expected 1 rows, received 0/,
  );
});

test('normalizes the official data.go.kr response envelope including a one-row page', () => {
  assert.deepEqual(normalizeDataGoPage({
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: {
        pageNo: 2,
        totalCount: 3,
        items: { item: { BRCD_NO: '96385074' } },
      },
    },
  }, 'foodqr'), {
    pageNo: 2,
    totalCount: 3,
    rows: [{ BRCD_NO: '96385074' }],
  });
});

test('normalizes the live MFDS direct envelope whose body.items is the row array', () => {
  assert.deepEqual(normalizeDataGoPage({
    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
    body: {
      pageNo: 1,
      totalCount: 2,
      items: [{ PDT_BARCD: '8800000000000' }, { PDT_BARCD: '96385074' }],
    },
  }, 'trace'), {
    pageNo: 1,
    totalCount: 2,
    rows: [{ PDT_BARCD: '8800000000000' }, { PDT_BARCD: '96385074' }],
  });
});

test('refuses a non-success data.go.kr response without leaking request credentials', () => {
  assert.throws(
    () => normalizeDataGoPage({
      response: {
        header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED ERROR' },
      },
    }, 'foodqr'),
    /foodqr: data\.go\.kr returned 30 SERVICE KEY IS NOT REGISTERED ERROR/,
  );
});

test('builds a data.go.kr URL without double-encoding the issued service key', () => {
  const url = buildDataGoUrl({
    baseUrl: 'https://apis.data.go.kr/example/list',
    serviceKey: 'abc%2Fdef%3D',
    pageNo: 2,
    pageSize: 500,
  });
  assert.equal(url.searchParams.get('serviceKey'), 'abc/def=');
  assert.match(url.href, /serviceKey=abc%2Fdef%3D/);
  assert.doesNotMatch(url.href, /%252F/);
});

test('parses only closed measurement CLI options', () => {
  assert.deepEqual(parseMeasurementArgs([]), {
    sourceIds: ['trace', 'foodqr-list', 'foodqr-label', 'foodqr-nutrients'],
    pageSize: 500,
    writeProfile: null,
  });
  assert.deepEqual(parseMeasurementArgs([
    '--source', 'trace', '--page-size', '100', '--write-profile', '/tmp/profile.json',
  ]), {
    sourceIds: ['trace'],
    pageSize: 100,
    writeProfile: '/tmp/profile.json',
  });
  assert.throws(() => parseMeasurementArgs(['--key', 'secret']), /unknown option --key/);
});
