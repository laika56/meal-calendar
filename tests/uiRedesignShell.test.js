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

test('entry shell keeps the approved quick-add wording and preset groups', () => {
  const html = read('public/index.html');
  assert.ok(html.includes('음식과 양을 같이 쓰면 바로 기록합니다. 개·공기는 대표 중량으로 추정합니다.'));
  assert.ok(html.includes('자주 먹는 것'));
  assert.ok(html.includes('한 끼 통째로'));
  assert.ok(html.includes('무엇을 먹었나요?'));
  assert.match(html, /name="saveAsPreset" type="checkbox" checked/);
});
