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

test('redesign uses the fixed deep-green dark tokens without a color-scheme branch', () => {
  const html = read('public/index.html');
  for (const color of ['#0a0b0d', '#131519', '#23262c', '#f2f4f7', '#9aa2ad', '#37d67a']) {
    assert.ok(html.includes(color), `missing redesign color ${color}`);
  }
  assert.doesNotMatch(html, /prefers-color-scheme/);
});

test('calendar rendering exposes a per-day ring progress value', () => {
  const app = read('public/app.js');
  assert.match(app, /class="day-ring"/);
  assert.match(app, /--ring-progress/);
  assert.match(app, /monthDashboardSummary/);
  assert.match(app, /progressPercent/);
});

test('entry shell keeps the approved quick-add wording and preset groups', () => {
  const html = read('public/index.html');
  assert.ok(html.includes('음식과 양을 같이 쓰면 바로 기록합니다. 개·공기는 대표 중량으로 추정합니다.'));
  assert.ok(html.includes('자주 먹는 것'));
  assert.ok(html.includes('한 끼 통째로'));
  assert.ok(html.includes('무엇을 먹었나요?'));
  assert.match(html, /name="saveAsPreset" type="checkbox" checked/);
});
