import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBarcodeCatalog,
  buildFoodQrCatalog,
  buildTraceCatalog,
  indexMfdsNutritionRows,
  parseFoodQrRow,
  parseTraceRow,
} from '../src/lib/barcodeCatalogSources.js';

const foodQrLabel = {
  ELB_MNG_NO: '202410221000001856',
  BRCD_NO: '08801007901244',
  QR_URL_ADDR: 'https://foodqr.kr/01/08801007901244',
  PRDCT_NM: '전복삼계죽 420g',
  FOOD_TYPE_CD_NM: '즉석조리식품',
  CTV: '420g (215kcal)',
  VLD_END_YMD: '99991231',
};

const foodQrNutrients = [
  ['열량', '215.000', 'kcal'],
  ['탄수화물', '40.000', 'g'],
  ['단백질', '11.000', 'g'],
  ['지방', '1.300', 'g'],
].map(([NIRWMT_NM, CTA, IGRD_UCD]) => ({
  ELB_MNG_NO: foodQrLabel.ELB_MNG_NO,
  BRCD_NO: foodQrLabel.BRCD_NO,
  PRDCT_NM: foodQrLabel.PRDCT_NM,
  BUES_NM: '씨제이제일제당(주)',
  NIRWMT_NM,
  CTA,
  IGRD_UCD,
  VLD_END_YMD: '99991231',
}));

test('joins FoodQR label and nutrient rows and converts one official package to per100g', () => {
  assert.deepEqual(parseFoodQrRow(foodQrLabel, foodQrNutrients, {
    verifiedAt: '2026-08-19',
  }), {
    candidate: {
      barcode: '8801007901244',
      name: '전복삼계죽 420g',
      maker: '씨제이제일제당(주)',
      category: '즉석조리식품',
      serving: null,
      per100g: {
        kcal: 51.19047619047619,
        carbG: 9.523809523809524,
        proteinG: 2.619047619047619,
        fatG: 0.30952380952380953,
      },
      source: {
        type: 'foodqr',
        sourceId: '202410221000001856',
        url: 'https://foodqr.kr/01/08801007901244',
        verifiedAt: '2026-08-19',
      },
    },
  });
});

test('groups FoodQR nutrients by exact managed identity and counts orphan rows', () => {
  const built = buildFoodQrCatalog([foodQrLabel], [
    ...foodQrNutrients,
    { ...foodQrNutrients[0], ELB_MNG_NO: 'orphan', BRCD_NO: '96385074' },
  ], { verifiedAt: '2026-08-19' });
  assert.equal(built.manifest.recordCount, 1);
  assert.equal(built.sourceCounts.labels, 1);
  assert.equal(built.sourceCounts.nutrients, 5);
  assert.equal(built.sourceCounts.orphanNutrients, 1);
});

test('uses the FoodQR list language code to exclude an English duplicate barcode', () => {
  const englishLabel = {
    ...foodQrLabel,
    ELB_MNG_NO: 'english-id',
    PRDCT_NM: 'English Product',
  };
  const englishNutrients = foodQrNutrients.map((row) => ({
    ...row, ELB_MNG_NO: 'english-id', PRDCT_NM: 'English Product',
  }));
  const lists = [
    { BRCD_NO: foodQrLabel.BRCD_NO, PRDT_NM: foodQrLabel.PRDCT_NM, LANG_CD: '001' },
    { BRCD_NO: foodQrLabel.BRCD_NO, PRDT_NM: foodQrLabel.PRDCT_NM, LANG_CD: '002' },
    { BRCD_NO: foodQrLabel.BRCD_NO, PRDT_NM: 'English Product', LANG_CD: '002' },
  ];
  const built = buildFoodQrCatalog(
    [foodQrLabel, englishLabel],
    [...foodQrNutrients, ...englishNutrients],
    { verifiedAt: '2026-08-19', listRows: lists },
  );
  assert.equal(built.manifest.recordCount, 1);
  assert.deepEqual(built.exclusionCounts, { 'non-korean-language': 1 });
  assert.equal(built.sourceCounts.list, 3);
});

test('excludes a whole FoodQR product when its own nutrient rows conflict', () => {
  const built = buildFoodQrCatalog([foodQrLabel], [
    ...foodQrNutrients,
    { ...foodQrNutrients[0], CTA: '999.000' },
  ], { verifiedAt: '2026-08-19' });
  assert.equal(built.manifest.recordCount, 0);
  assert.deepEqual(built.exclusionCounts, { 'nutrient-conflict': 1 });
});

test('excludes a whole FoodQR product with a nonnumeric core nutrient', () => {
  const built = buildFoodQrCatalog([foodQrLabel], foodQrNutrients.map((row) => (
    row.NIRWMT_NM === '열량' ? { ...row, CTA: '-' } : row
  )), { verifiedAt: '2026-08-19' });
  assert.equal(built.manifest.recordCount, 0);
  assert.deepEqual(built.exclusionCounts, { 'invalid-nutrient-value': 1 });
});

test('builds a deterministic sorted catalog and counts every exclusion', () => {
  const first = parseFoodQrRow(foodQrLabel, foodQrNutrients, { verifiedAt: '2026-08-19' });
  const second = parseFoodQrRow({
    ...foodQrLabel,
    ELB_MNG_NO: 'second',
    BRCD_NO: '96385074',
    QR_URL_ADDR: 'https://foodqr.kr/01/96385074',
    PRDCT_NM: '두 번째',
  }, foodQrNutrients.map((row) => ({
    ...row,
    ELB_MNG_NO: 'second',
    BRCD_NO: '96385074',
    PRDCT_NM: '두 번째',
  })), { verifiedAt: '2026-08-19' });
  const built = buildBarcodeCatalog([
    first,
    { exclusion: 'expired' },
    second,
    { exclusion: 'expired' },
  ]);
  assert.deepEqual(built.records.map(({ barcode }) => barcode), ['8801007901244', '96385074']);
  assert.deepEqual(built.exclusionCounts, { expired: 2 });
  assert.equal(built.manifest.schemaVersion, 1);
  assert.equal(built.manifest.recordCount, 2);
  assert.match(built.manifest.materialSha256, /^[a-f0-9]{64}$/u);
});

test('excludes every same-rank candidate when one barcode has conflicting official identities', () => {
  const first = parseFoodQrRow(foodQrLabel, foodQrNutrients, { verifiedAt: '2026-08-19' });
  const conflicting = {
    candidate: {
      ...first.candidate,
      name: '서로 다른 공식 제품',
      source: { ...first.candidate.source, sourceId: 'different-official-row' },
    },
  };
  const built = buildBarcodeCatalog([first, conflicting]);
  assert.deepEqual(built.records, []);
  assert.deepEqual(built.exclusionCounts, { 'ambiguous-barcode': 2 });
});

test('preserves missing FoodQR macros as null without inventing zero', () => {
  const result = parseFoodQrRow(foodQrLabel, foodQrNutrients.slice(0, 2), {
    verifiedAt: '2026-08-19',
  });
  assert.deepEqual(result.candidate.per100g, {
    kcal: 51.19047619047619,
    carbG: 9.523809523809524,
    proteinG: null,
    fatG: null,
  });
});

test('accepts measured simple and kilogram package quantity forms', () => {
  const withServing = foodQrNutrients.map((row) => ({
    ...row, NTRTN_ICUT_CTV: '420.000', NTRTN_ICUT_CVUCD: 'g',
  }));
  const simple = parseFoodQrRow({ ...foodQrLabel, CTV: '420g' }, withServing, {
    verifiedAt: '2026-08-19',
  });
  assert.equal(simple.candidate.serving.amount, 420);
  const kilogram = parseFoodQrRow({ ...foodQrLabel, CTV: '1kg' }, foodQrNutrients.map((row) => ({
    ...row,
    CTA: row.NIRWMT_NM === '열량' ? '215.000' : row.CTA,
    NTRTN_ICUT_CTV: '1000.000',
    NTRTN_ICUT_CVUCD: 'g',
  })), { verifiedAt: '2026-08-19' });
  assert.deepEqual(kilogram.candidate.serving, {
    amount: 1000, unit: 'g', source: 'official-serving',
  });
});

test('derives a nutrition basis from official package kcal without calling it a serving', () => {
  const result = parseFoodQrRow({ ...foodQrLabel, CTV: '500mL (1,025kcal)' }, foodQrNutrients.map((row) => ({
    ...row,
    CTA: row.NIRWMT_NM === '열량' ? '205.000' : row.CTA,
  })), { verifiedAt: '2026-08-19' });
  assert.equal(result.candidate.serving, null);
  assert.ok(Math.abs(result.candidate.per100g.kcal - 205) < 1e-9);
});

test('uses the declared nutrition serving when a package contains multiple servings', () => {
  const nutrients = foodQrNutrients.map((row) => ({
    ...row,
    CTA: row.NIRWMT_NM === '열량' ? '605.000' : row.CTA,
    NTRTN_ICUT_CTV: '325.000',
    NTRTN_ICUT_CVUCD: 'g',
  }));
  const result = parseFoodQrRow({ ...foodQrLabel, CTV: '650g (1,210kcal)' }, nutrients, {
    verifiedAt: '2026-08-19',
  });
  assert.deepEqual(result.candidate.serving, {
    amount: 325, unit: 'g', source: 'official-serving',
  });
  assert.equal(result.candidate.per100g.kcal, (605 / 325) * 100);
});

test('keeps the declared nutrition serving despite rounded package kcal display', () => {
  const nutrients = foodQrNutrients.map((row) => ({
    ...row,
    CTA: row.NIRWMT_NM === '열량' ? '615.600' : row.CTA,
    NTRTN_ICUT_CTV: '420.000',
    NTRTN_ICUT_CVUCD: 'g',
  }));
  assert.ok(parseFoodQrRow({ ...foodQrLabel, CTV: '420g (615kcal)' }, nutrients, {
    verifiedAt: '2026-08-19',
  }).candidate);
  assert.ok(parseFoodQrRow(
    { ...foodQrLabel, CTV: '420g (614kcal)' },
    nutrients,
    { verifiedAt: '2026-08-19' },
  ).candidate);
});

test('excludes expired, malformed quantity, mismatched identity, and invalid barcode FoodQR rows', () => {
  assert.deepEqual(parseFoodQrRow(
    { ...foodQrLabel, VLD_END_YMD: '20250516' },
    foodQrNutrients,
    { verifiedAt: '2026-08-19' },
  ), { exclusion: 'expired' });
  assert.deepEqual(parseFoodQrRow(
    { ...foodQrLabel, VLD_END_YMD: null },
    foodQrNutrients,
    { verifiedAt: '2026-08-19' },
  ), { exclusion: 'missing-valid-end' });
  assert.deepEqual(parseFoodQrRow(
    { ...foodQrLabel, CTV: '350g 35g*10포' },
    foodQrNutrients,
    { verifiedAt: '2026-08-19' },
  ), { exclusion: 'unsupported-quantity' });
  assert.throws(
    () => parseFoodQrRow(foodQrLabel, [
      { ...foodQrNutrients[0], ELB_MNG_NO: 'different' },
    ], { verifiedAt: '2026-08-19' }),
    /FoodQR nutrient identity mismatch/,
  );
  assert.deepEqual(parseFoodQrRow(
    { ...foodQrLabel, BRCD_NO: '08801007901245' },
    [],
    { verifiedAt: '2026-08-19' },
  ), { exclusion: 'invalid-barcode' });
  assert.deepEqual(parseFoodQrRow(foodQrLabel, [], { verifiedAt: '2026-08-19' }), {
    exclusion: 'missing-kcal',
  });
  assert.deepEqual(parseFoodQrRow(foodQrLabel, foodQrNutrients.map((row) => ({
    ...row, NTRTN_ICUT_CTV: '100.000', NTRTN_ICUT_CVUCD: 'ml',
  })), { verifiedAt: '2026-08-19' }), { exclusion: 'unit-conflict' });
});

test('joins a trace row only through its exact reviewed report number', () => {
  const row = {
    PDT_BARCD: '8801007901244',
    PDT_NM: '검증 제품',
    BRNCH_NM: '검증 제조사',
    PDT_TYP_CD: '즉석조리식품',
    PRDLST_REPORT_NO: 'report-1',
    USE_FLAG: '1',
    CANCEL_TARGET_AT: '0',
  };
  const nutritionIndex = new Map([['report-1', {
    serving: { amount: 100, unit: 'g', source: 'official-serving' },
    per100g: { kcal: 120, carbG: null, proteinG: 5, fatG: null },
    sourceId: 'nutrition-report-1',
    url: 'https://example.test/nutrition/report-1',
  }]]);
  assert.deepEqual(parseTraceRow(row, nutritionIndex, { verifiedAt: '2026-08-19' }), {
    candidate: {
      barcode: '8801007901244',
      name: '검증 제품',
      maker: '검증 제조사',
      category: '즉석조리식품',
      serving: { amount: 100, unit: 'g', source: 'official-serving' },
      per100g: { kcal: 120, carbG: null, proteinG: 5, fatG: null },
      source: {
        type: 'mfds-joined',
        sourceId: 'nutrition-report-1',
        url: 'https://example.test/nutrition/report-1',
        verifiedAt: '2026-08-19',
      },
    },
  });
  assert.deepEqual(parseTraceRow(row, new Map(), { verifiedAt: '2026-08-19' }), {
    exclusion: 'missing-nutrition-join',
  });
  assert.deepEqual(parseTraceRow(
    { ...row, CANCEL_TARGET_AT: '1' },
    nutritionIndex,
    { verifiedAt: '2026-08-19' },
  ), { exclusion: 'inactive' });
});

test('builds trace candidates only from active exact report-number nutrition joins', () => {
  const trace = {
    PDT_BARCD: '8801007901244', PDT_NM: '검증 제품', BRNCH_NM: '검증 제조사',
    PDT_TYP_CD: '즉석조리식품', PRDLST_REPORT_NO: 'report-1', USE_FLAG: '1', CANCEL_TARGET_AT: '0',
  };
  const nutrition = {
    ITEM_REPORT_NO: 'report-1', FOOD_CD: 'food-1', FOOD_NM_KR: '검증 제품',
    FOOD_CAT1_NM: '즉석조리식품', SERVING_SIZE: '100g', AMT_NUM1: '120',
    AMT_NUM3: '5', AMT_NUM4: '', AMT_NUM6: '20', MAKER_NM: '검증 제조사',
    DB_GRP_CM: 'P', Z10500: '', NUTRI_AMOUNT_SERVING: '80g',
  };
  const built = buildTraceCatalog([trace, { ...trace, USE_FLAG: '0' }], [nutrition], {
    verifiedAt: '2026-08-19',
  });
  assert.equal(built.manifest.recordCount, 1);
  assert.deepEqual(built.records[0].serving, { amount: 80, unit: 'g', source: 'official-serving' });
  assert.deepEqual(built.exclusionCounts, { inactive: 1 });
  assert.equal(built.sourceCounts.trace, 2);
  assert.equal(built.sourceCounts.nutrition, 1);

  const index = new Map();
  const conflicts = new Set();
  indexMfdsNutritionRows(index, conflicts, [nutrition]);
  const streamed = buildTraceCatalog([trace], index, {
    verifiedAt: '2026-08-19', conflictedReports: conflicts, nutritionCount: 1,
  });
  assert.deepEqual(streamed.records, built.records);
});
