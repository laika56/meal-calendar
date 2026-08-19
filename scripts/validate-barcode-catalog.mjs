#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBarcodeCatalog } from '../src/lib/barcodeCatalog.js';

const EXPECTED = [
  'BARCODE_CATALOG_REVIEW.md',
  'barcode-catalog-manifest.json',
  'barcode-foods.ndjson',
];

export async function validateBarcodeArtifacts(directory) {
  const root = path.resolve(directory);
  const names = (await readdir(root)).toSorted();
  if (JSON.stringify(names) !== JSON.stringify(EXPECTED)) {
    throw new Error('barcode staging must contain exactly the reviewed artifact set');
  }
  const [material, manifestBytes, review] = await Promise.all([
    readFile(path.join(root, 'barcode-foods.ndjson'), 'utf8'),
    readFile(path.join(root, 'barcode-catalog-manifest.json'), 'utf8'),
    readFile(path.join(root, 'BARCODE_CATALOG_REVIEW.md'), 'utf8'),
  ]);
  if (!review.startsWith('# Barcode Catalog Review\n') && !review.startsWith('# Review\n')) {
    throw new Error('barcode review artifact is malformed');
  }
  if (!material.endsWith('\n')) throw new Error('barcode material must end with newline');
  const lines = material.slice(0, -1);
  const records = lines === '' ? [] : lines.split('\n').map((line) => JSON.parse(line));
  const manifest = JSON.parse(manifestBytes);
  validateBarcodeCatalog(records, manifest);
  return { records, manifest };
}

async function main() {
  if (process.argv.length !== 3) throw new Error('usage: validate-barcode-catalog.mjs directory');
  const validated = await validateBarcodeArtifacts(process.argv[2]);
  process.stdout.write(`No issues. ${validated.records.length} records.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.name}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
