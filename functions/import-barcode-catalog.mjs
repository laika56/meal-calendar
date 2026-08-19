import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { validateBarcodeCatalog } from '../src/lib/barcodeCatalog.js';
import { validateBarcodeArtifacts } from '../scripts/validate-barcode-catalog.mjs';

const RUNS_PATH = 'barcodeCatalogRuns';
const CURRENT_POINTER_PATH = 'barcodeCatalogState/current';
const MAX_BATCH_WRITES = 400;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function chunks(values) {
  const result = [];
  for (let index = 0; index < values.length; index += MAX_BATCH_WRITES) {
    result.push(values.slice(index, index + MAX_BATCH_WRITES));
  }
  return result;
}

function expectedDocuments(runId, records) {
  return records.map((record) => ({
    path: `${RUNS_PATH}/${runId}/foods/${record.barcode}`,
    data: structuredClone(record),
  }));
}

export function buildBarcodeImportPlan(currentPointer, artifact, runId) {
  const validated = validateBarcodeCatalog(artifact?.records, artifact?.manifest);
  const resolvedRunId = runId ?? `barcode-catalog-${validated.manifest.materialSha256}`;
  if (typeof resolvedRunId !== 'string' || !resolvedRunId) throw new TypeError('runId must be a non-empty string');
  const documents = expectedDocuments(resolvedRunId, validated.records);
  const payloadSha256 = sha256(documents);
  const preflightPointer = currentPointer === undefined ? null : structuredClone(currentPointer);
  const expectedPointer = {
    runId: resolvedRunId,
    recordCount: validated.manifest.recordCount,
    materialSha256: validated.manifest.materialSha256,
    payloadSha256,
  };
  const unchanged = preflightPointer !== null
    && Object.entries(expectedPointer).every(([key, value]) => preflightPointer[key] === value);
  const run = {
    path: `${RUNS_PATH}/${resolvedRunId}`,
    data: {
      runId: resolvedRunId,
      status: 'staging',
      recordCount: validated.manifest.recordCount,
      materialSha256: validated.manifest.materialSha256,
      payloadSha256,
    },
  };
  return {
    runId: resolvedRunId,
    currentPointer: preflightPointer,
    unchanged,
    run,
    documents,
    batches: unchanged ? [] : chunks(documents),
    payloadSha256,
  };
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function pointerFor(plan) {
  return {
    runId: plan.runId,
    recordCount: plan.run.data.recordCount,
    materialSha256: plan.run.data.materialSha256,
    payloadSha256: plan.payloadSha256,
  };
}

async function verifyStagedRun(firestore, plan) {
  const runSnapshot = await firestore.doc(plan.run.path).get();
  if (!runSnapshot.exists || !same(runSnapshot.data(), plan.run.data)) {
    throw new Error('staged barcode run manifest mismatch');
  }
  const snapshot = await firestore.collection(`${plan.run.path}/foods`).get();
  const actual = snapshot.docs.map((document) => ({
    path: `${plan.run.path}/foods/${document.id}`,
    data: document.data(),
  })).toSorted((left, right) => left.path.localeCompare(right.path));
  const expected = plan.documents.toSorted((left, right) => left.path.localeCompare(right.path));
  if (actual.length !== expected.length || sha256(actual) !== plan.payloadSha256) {
    throw new Error('staged barcode payload mismatch');
  }
}

export async function applyBarcodeImport(firestore, plan, { now = () => new Date().toISOString() } = {}) {
  if (plan?.unchanged) return { status: 'unchanged', runId: plan.runId };
  verifyBarcodeImportPlan(plan, {
    records: plan.documents.map(({ data }) => data),
    manifest: {
      schemaVersion: 1,
      recordCount: plan.run.data.recordCount,
      materialSha256: plan.run.data.materialSha256,
    },
  });
  await firestore.doc(plan.run.path).set(plan.run.data);
  for (const documents of plan.batches) {
    const batch = firestore.batch();
    for (const document of documents) batch.set(firestore.doc(document.path), document.data);
    await batch.commit();
  }
  await verifyStagedRun(firestore, plan);
  const publishedAt = now();
  if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) {
    throw new TypeError('now must return an ISO date string');
  }
  const nextPointer = { ...pointerFor(plan), publishedAt };
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(firestore.doc(CURRENT_POINTER_PATH));
    const actual = snapshot.exists ? snapshot.data() : null;
    if (!same(actual, plan.currentPointer)) throw new Error('barcode catalog pointer changed since preflight');
    transaction.set(firestore.doc(plan.run.path), { ...plan.run.data, status: 'ready' });
    transaction.set(firestore.doc(CURRENT_POINTER_PATH), nextPointer);
  });
  return { status: 'ready', pointer: nextPointer, runId: plan.runId };
}

export async function runBarcodeImportCli({
  args = process.argv.slice(2), firestore, write = (line) => process.stdout.write(line),
} = {}) {
  const apply = args.includes('--apply');
  const positional = args.filter((argument) => argument !== '--apply');
  if (positional.length !== 1 || args.some((argument) => argument.startsWith('--') && argument !== '--apply')) {
    throw new Error('usage: node functions/import-barcode-catalog.mjs staging-directory [--apply]');
  }
  const artifact = await validateBarcodeArtifacts(positional[0]);
  const db = firestore ?? getFirestore(getApps().length > 0 ? getApps()[0] : initializeApp());
  const pointerSnapshot = await db.doc(CURRENT_POINTER_PATH).get();
  const plan = buildBarcodeImportPlan(pointerSnapshot.exists ? pointerSnapshot.data() : null, artifact);
  const lines = [
    `mode ${apply ? 'apply' : 'dry-run'}`,
    `runId ${plan.runId}`,
    `records ${plan.run.data.recordCount}`,
    `materialSha256 ${plan.run.data.materialSha256}`,
    `payloadSha256 ${plan.payloadSha256}`,
    `writes ${plan.unchanged ? 0 : plan.documents.length + 1}`,
  ];
  if (!apply) {
    write(`${lines.join('\n')}\n`);
    return { status: 'dry-run', plan };
  }
  const result = await applyBarcodeImport(db, plan);
  write(`${[...lines, `status ${result.status}`].join('\n')}\n`);
  return { ...result, plan };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBarcodeImportCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export function verifyBarcodeImportPlan(plan, artifact) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new TypeError('plan must be an object');
  }
  const validated = validateBarcodeCatalog(artifact?.records, artifact?.manifest);
  const expected = expectedDocuments(plan.runId, validated.records);
  const paths = new Set();
  for (const document of plan.documents ?? []) {
    if (paths.has(document.path)) throw new Error(`duplicate document path ${document.path}`);
    paths.add(document.path);
  }
  if (canonicalJson(plan.documents) !== canonicalJson(expected)) {
    throw new Error('artifact payload mismatch');
  }
  if (plan.payloadSha256 !== sha256(expected)) throw new Error('plan payload hash mismatch');
  if (canonicalJson(plan.batches) !== canonicalJson(chunks(expected))) {
    throw new Error('plan batches mismatch');
  }
  return true;
}
