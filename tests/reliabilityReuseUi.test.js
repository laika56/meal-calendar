import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('public/index.html', root), 'utf8');
const app = await readFile(new URL('public/app.js', root), 'utf8');
const db = await readFile(new URL('public/db.js', root), 'utf8');

test('shell exposes all six reliability and reuse entry points', () => {
  for (const id of [
    'nutritionLabelOpen', 'nutritionLabelFile', 'nutritionLabelStatus',
    'openWeeklySummary', 'weeklySummary', 'weeklySummaryContent',
    'exportJson', 'exportCsv', 'importJsonFile', 'importStatus',
    'saveDayPreset', 'revisionHistory', 'revisionHistoryContent',
  ]) assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
});

test('app imports and consumes every approved pure module', () => {
  for (const module of [
    'nutritionLabel.js', 'weeklySummary.js', 'entryRevision.js',
    'dataTransfer.js', 'presetV2.js', 'nutritionLabelOcr.js',
  ]) assert.match(app, new RegExp(module.replace('.', '\\.')));
  assert.match(app, /lookupBarcodeIdentity/);
});

test('database exposes range, export, restore, and structured preset boundaries', () => {
  for (const name of ['loadDaysByKeys', 'loadExportData', 'restoreExportData', 'saveStructuredPreset']) {
    assert.match(db, new RegExp(`export async function ${name}\\b`));
  }
});
