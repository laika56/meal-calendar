import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('authenticated clients cannot read or write catalog state, run roots, or run descendants', async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip('requires firebase emulators:exec --only firestore');
    return;
  }
  const testEnvironment = await initializeTestEnvironment({
    projectId: 'meal-calendar-catalog-rules',
    firestore: {
      rules: await readFile(path.join(projectRoot, 'firestore.rules'), 'utf8'),
    },
  });
  t.after(() => testEnvironment.cleanup());
  const firestore = testEnvironment.authenticatedContext('catalog-client').firestore();

  for (const documentPath of [
    'franchiseCatalogState/current',
    'franchiseCatalogRuns/test-run',
    'franchiseCatalogRuns/test-run/sources/test-source',
    'franchiseCatalogRuns/test-run/brands/test-brand',
    'franchiseCatalogRuns/test-run/foods/test-food',
    'barcodeCatalogState/current',
    'barcodeCatalogRuns/test-run',
    'barcodeCatalogRuns/test-run/foods/8801007901244',
  ]) {
    const reference = doc(firestore, documentPath);
    await assertFails(getDoc(reference));
    await assertFails(setDoc(reference, { attemptedBy: 'client' }));
  }
});

test('rules explicitly close barcode catalog state and run namespaces', async () => {
  const rules = await readFile(path.join(projectRoot, 'firestore.rules'), 'utf8');
  assert.match(rules, /match \/barcodeCatalogState\/\{id\}/u);
  assert.match(rules, /match \/barcodeCatalogRuns\/\{runId\}/u);
});
