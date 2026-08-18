import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('calendar shell contains the approved four-card monthly summary', () => {
  const html = read('public/index.html');
  for (const id of ['monthAverage', 'monthRecorded', 'monthOnTarget', 'monthWeight']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const label of ['평균', '기록일', '적정일', '체중']) {
    assert.match(html, new RegExp(`>${label}<`));
  }
});

test('day detail shell contains the approved gauge and four metric cards', () => {
  const html = read('public/index.html');
  assert.match(html, /id="calorieGauge"/);
  assert.match(html, /class="gauge-track"/);
  assert.match(html, /id="macroRow" class="metric-grid"/);
  assert.match(html, /class="weight-card metric-card"/);
});

test('full-screen sheets stack above calendar ring dates', () => {
  const html = read('public/index.html');
  const sheetLayer = html.match(/\.sheet\s*\{[^}]*z-index:\s*(\d+)/s);
  const dayNumberLayer = html.match(/\.day-num\s*\{[^}]*z-index:\s*(\d+)/s);

  assert.ok(sheetLayer, 'full-screen sheet must establish an explicit stacking layer');
  assert.ok(dayNumberLayer, 'calendar day number stacking layer is missing');
  assert.ok(
    Number(sheetLayer[1]) > Number(dayNumberLayer[1]),
    'full-screen sheet must cover calendar day numbers',
  );
});

test('redesign uses the fixed deep-green dark tokens without a color-scheme branch', () => {
  const html = read('public/index.html');
  for (const color of ['#0a0b0d', '#131519', '#23262c', '#f2f4f7', '#9aa2ad', '#37d67a']) {
    assert.ok(html.includes(color), `missing redesign color ${color}`);
  }
  assert.doesNotMatch(html, /prefers-color-scheme/);
});

test('calendar rendering exposes a per-day ring progress value', () => {
  const app = read('public/app.js');
  const html = read('public/index.html');
  const ringRule = html.match(/\.day-ring\s*\{([^}]*)\}/s);

  assert.match(app, /class="day-ring"/);
  assert.match(app, /--ring-progress/);
  assert.match(app, /monthDashboardSummary/);
  assert.match(app, /progressPercent/);
  assert.ok(ringRule, 'day ring CSS rule is missing');
  assert.doesNotMatch(
    ringRule[1],
    /--ring-progress\s*:/,
    'day ring must inherit the per-day progress instead of overriding it',
  );
  assert.doesNotMatch(
    app,
    /button\.style\.setProperty\('--ring-progress'/,
    'a cached day-ring rule can override progress placed only on its parent button',
  );
  assert.match(
    app,
    /button\.querySelector\('\.day-ring'\)\.style\.setProperty\(\s*'--ring-progress'/,
    'progress must be placed directly on the rendered ring to override a cached zero value',
  );
});

test('day detail entries keep calories in one right-aligned column', () => {
  const html = read('public/index.html');
  const lineRule = html.match(/\.entry-line\s*\{([^}]*)\}/s);
  const kcalRule = html.match(/\.entry-kcal\s*\{([^}]*)\}/s);

  assert.ok(lineRule, 'entry line CSS rule is missing');
  assert.match(lineRule[1], /display:\s*grid/);
  assert.match(lineRule[1], /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+24px/);
  assert.ok(kcalRule, 'entry kcal CSS rule is missing');
  assert.match(kcalRule[1], /text-align:\s*right/);
});

test('day weight input stays at 16px or larger so iOS does not zoom on focus', () => {
  const html = read('public/index.html');
  const inputRule = html.match(/\.weight-control input\s*\{([^}]*)\}/s);

  assert.ok(inputRule, 'day weight input CSS rule is missing');
  const fontSize = inputRule[1].match(/font-size:\s*([\d.]+)px/);
  assert.ok(fontSize, 'day weight input must declare a pixel font size');
  assert.ok(
    Number(fontSize[1]) >= 16,
    'day weight input must be at least 16px to prevent iOS focus zoom',
  );
});

test('entry shell keeps the approved quick-add wording and preset groups', () => {
  const html = read('public/index.html');
  assert.ok(html.includes('음식과 양을 같이 쓰면 바로 기록합니다. 개·공기는 대표 중량으로 추정합니다.'));
  assert.ok(html.includes('자주 먹는 것'));
  assert.ok(html.includes('한 끼 통째로'));
  assert.ok(html.includes('무엇을 먹었나요?'));
  assert.match(html, /name="saveAsPreset" type="checkbox" checked/);
});

test('entry shell includes the static barcode scanner controls and exact fallback copy', () => {
  const html = read('public/index.html');

  for (const id of [
    'barcodeOpen', 'barcodeScanner', 'barcodeVideo', 'barcodeCanvas', 'barcodeStatus', 'barcodeCancel',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  for (const copy of [
    '바코드 스캔',
    '바코드를 비춰주세요',
    '취소',
    '제품 정보를 확인하고 있습니다.',
    'Open Food Facts에서 제품을 찾지 못했습니다. 직접 입력해 주세요.',
    '제품은 찾았지만 영양정보가 없습니다. 직접 입력해 주세요.',
    '카메라를 사용할 수 없습니다. 직접 입력해 주세요.',
  ]) {
    assert.ok(html.includes(copy), `missing barcode copy: ${copy}`);
  }
});

test('barcode flow lazy-loads the pinned reader and closes camera tracks at lifecycle boundaries', () => {
  const html = read('public/index.html');
  const app = read('public/app.js');

  assert.doesNotMatch(html, /zxing-wasm@/i, 'the decoder must not load before a scanner tap');
  assert.match(
    app,
    /https:\/\/cdn\.jsdelivr\.net\/npm\/zxing-wasm@3\.1\.3\/dist\/iife\/reader\/index\.js/,
  );
  assert.match(app, /facingMode:\s*\{\s*ideal:\s*'environment'\s*\}/);
  assert.match(app, /formats:\s*BARCODE_FORMATS/);
  assert.match(app, /maxNumberOfSymbols:\s*1/);
  assert.match(app, /for \(const track of barcodeStream\?\.getTracks\?\.\(\) \?\? \[\]\) track\.stop\(\)/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /document\.getElementById\('closeEntry'\)[\s\S]*?stopBarcodeScanner\(\)/);
  assert.match(app, /source:\s*food\.source/);
  assert.match(app, /barcode:\s*food\.barcode/);
});

test('search results expose response-provided source and serving nutrition safely', () => {
  const html = read('public/index.html');
  const app = read('public/app.js');

  assert.match(html, /id="partialNutritionNote"/);
  assert.match(app, /createSearchResult/);
  assert.doesNotMatch(app, /isFranchise\s*\?\s*['"]공식값/);
});

test('partial search selection preserves numeric values and identifies every missing field', () => {
  const app = read('public/app.js');

  assert.match(app, /showPartialNutritionEntry/);
  assert.match(app, /nutritionProvenance/);
});

test('blank manual nutrient fields are not coerced to zero during partial completion', () => {
  const app = read('public/app.js');

  assert.match(app, /formNumber\(data, 'carbG'\)/);
  assert.match(app, /buildPartialNutritionProvenance/);
});

test('broad catalog searches give the approved refinement instruction', () => {
  const app = read('public/app.js');

  assert.match(app, /consumeSearchCandidates/);
  assert.match(app, /searchResultStatus\(\{ hasMore, parsed \}\)/);
});
