const RECORD_KEYS = new Set([
  'barcode', 'name', 'maker', 'category', 'serving', 'per100g', 'source',
]);
const NUTRIENT_KEYS = new Set(['kcal', 'carbG', 'proteinG', 'fatG']);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function checkDigit(body) {
  let sum = 0;
  for (let index = body.length - 1, offset = 0; index >= 0; index -= 1, offset += 1) {
    sum += Number(body[index]) * (offset % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

export function canonicalBarcode(value) {
  if (typeof value !== 'string' || !/^\d{8}$|^\d{12,14}$/u.test(value)) return null;
  if (checkDigit(value.slice(0, -1)) !== value.at(-1)) return null;
  if (value.length === 12) return `0${value}`;
  if (value.length === 14 && value.startsWith('0')) return value.slice(1);
  return value;
}

function assertManifest(value, label, status = null) {
  assertObject(value, label);
  if (typeof value.runId !== 'string' || !value.runId) throw new TypeError(`${label}.runId is invalid`);
  if (!Number.isSafeInteger(value.recordCount) || value.recordCount < 0) throw new TypeError(`${label}.recordCount is invalid`);
  if (typeof value.materialSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.materialSha256)) throw new TypeError(`${label}.materialSha256 is invalid`);
  if (status !== null && value.status !== status) throw new Error(`${label}.status must be ${status}`);
}

function sameManifest(pointer, run) {
  return pointer.runId === run.runId
    && pointer.recordCount === run.recordCount
    && pointer.materialSha256 === run.materialSha256;
}

function validateRecord(value, expectedBarcode) {
  assertObject(value, 'barcode catalog record');
  for (const key of Object.keys(value)) {
    if (!RECORD_KEYS.has(key)) throw new TypeError(`barcode catalog record has unexpected key ${key}`);
  }
  for (const key of RECORD_KEYS) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`barcode catalog record is missing ${key}`);
  }
  if (canonicalBarcode(value.barcode) !== expectedBarcode || value.barcode !== expectedBarcode) throw new Error('barcode catalog record identity mismatch');
  if (typeof value.name !== 'string' || !value.name.trim()) throw new TypeError('barcode catalog record name is invalid');
  if (value.maker !== null && typeof value.maker !== 'string') throw new TypeError('maker is invalid');
  if (value.category !== null && typeof value.category !== 'string') throw new TypeError('category is invalid');
  assertObject(value.per100g, 'per100g');
  for (const key of Object.keys(value.per100g)) {
    if (!NUTRIENT_KEYS.has(key)) throw new TypeError(`per100g has unexpected key ${key}`);
  }
  for (const key of NUTRIENT_KEYS) {
    const nutrient = value.per100g[key];
    if (nutrient !== null && (typeof nutrient !== 'number' || !Number.isFinite(nutrient) || nutrient < 0)) throw new TypeError(`per100g.${key} is invalid`);
  }
  assertObject(value.source, 'source');
  return structuredClone(value);
}

export async function queryBarcodeCatalog(db, code) {
  if (!db || typeof db.doc !== 'function') throw new TypeError('db must be Firestore-compatible');
  const barcode = canonicalBarcode(code);
  if (barcode === null) throw new TypeError('invalid barcode');
  const pointerSnapshot = await db.doc('barcodeCatalogState/current').get();
  if (!pointerSnapshot.exists) throw new Error('barcode catalog current pointer is missing');
  const pointer = pointerSnapshot.data();
  assertManifest(pointer, 'barcode catalog current pointer');
  const runPath = `barcodeCatalogRuns/${pointer.runId}`;
  const runSnapshot = await db.doc(runPath).get();
  if (!runSnapshot.exists) throw new Error('barcode catalog ready run is missing');
  const run = runSnapshot.data();
  assertManifest(run, 'barcode catalog ready run', 'ready');
  if (!sameManifest(pointer, run)) throw new Error('barcode catalog ready run does not match current pointer');
  const recordSnapshot = await db.doc(`${runPath}/foods/${barcode}`).get();
  if (!recordSnapshot.exists) return null;
  return validateRecord(recordSnapshot.data(), barcode);
}
