import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeCatalogText, validateCatalogRecord } from '../src/lib/franchiseCatalog.js';

const SOURCE_TYPES = new Set(['official_brand', 'public_data', 'general_reference']);
const SOURCE_KEYS = new Set(['id', 'type', 'name', 'url', 'licenseNote', 'checkedAt', 'active']);
const BRAND_KEYS = new Set([
  'id', 'name', 'normalizedName', 'aliases', 'category', 'officialUrl', 'active', 'createdAt', 'updatedAt',
]);
const SNAPSHOT_KEYS = new Set(['generatedAt', 'sourceId', 'sourceManifestSha256', 'records']);
const ISO_UTC_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256 = /^[a-f0-9]{64}$/;

class CatalogDataRefusal extends Error {}

function refuse(message) {
  throw new CatalogDataRefusal(message);
}

function assertPlainObject(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    refuse(`${label} must be an object`);
  }
}

function assertClosedShape(value, keys, label) {
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) refuse(`${label} has unknown key ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) refuse(`${label} is missing required key ${key}`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value === '') refuse(`${label} must be a non-empty string`);
}

function assertIsoUtcDate(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (
    typeof value !== 'string'
    || !ISO_UTC_DATE.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    refuse(`${label} must be an ISO UTC date`);
  }
}

function assertHttpUrl(value, label) {
  assertNonEmptyString(value, label);
  let url;
  try {
    url = new URL(value);
  } catch {
    refuse(`${label} must be an absolute http or https URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    refuse(`${label} must be an absolute http or https URL`);
  }
  return url;
}

function assertCanonicalTextArray(value, label) {
  if (!Array.isArray(value)) refuse(`${label} must be an array`);
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    assertNonEmptyString(item, `${label}[${index}]`);
    const normalized = normalizeCatalogText(item);
    if (item !== normalized) refuse(`${label}[${index}] must be canonical`);
    if (seen.has(normalized)) refuse(`${label} contains duplicate normalized alias ${normalized}`);
    seen.add(normalized);
  }
}

function assertSortedById(items, label) {
  for (let index = 1; index < items.length; index += 1) {
    if (items[index - 1].id.localeCompare(items[index].id, 'en') > 0) {
      refuse(`${label} must be sorted by id`);
    }
  }
}

function validateSources(sources) {
  if (!Array.isArray(sources)) refuse('sources must be an array');
  assertSortedById(sources, 'sources');
  const ids = new Set();
  for (const source of sources) {
    assertClosedShape(source, SOURCE_KEYS, 'source');
    assertNonEmptyString(source.id, 'source.id');
    if (ids.has(source.id)) refuse(`duplicate source id ${source.id}`);
    ids.add(source.id);
    if (!SOURCE_TYPES.has(source.type)) refuse(`source.type is unsupported for ${source.id}`);
    assertNonEmptyString(source.name, 'source.name');
    assertHttpUrl(source.url, 'source.url');
    if (source.licenseNote !== null && typeof source.licenseNote !== 'string') {
      refuse(`source.licenseNote must be null or a string for ${source.id}`);
    }
    assertIsoUtcDate(source.checkedAt, 'source.checkedAt');
    if (typeof source.active !== 'boolean') refuse(`source.active must be a boolean for ${source.id}`);
  }
  return sources;
}

function validateBrands(brands) {
  if (!Array.isArray(brands)) refuse('brands must be an array');
  assertSortedById(brands, 'brands');
  const ids = new Set();
  const aliases = new Set();
  for (const brand of brands) {
    assertClosedShape(brand, BRAND_KEYS, 'brand');
    assertNonEmptyString(brand.id, 'brand.id');
    if (ids.has(brand.id)) refuse(`duplicate brand id ${brand.id}`);
    ids.add(brand.id);
    assertNonEmptyString(brand.name, 'brand.name');
    if (brand.normalizedName !== normalizeCatalogText(brand.name)) {
      refuse(`brand.normalizedName must equal normalized name for ${brand.id}`);
    }
    assertCanonicalTextArray(brand.aliases, `brand.aliases for ${brand.id}`);
    for (const alias of brand.aliases) {
      if (aliases.has(alias)) refuse(`duplicate normalized brand alias ${alias}`);
      aliases.add(alias);
    }
    assertNonEmptyString(brand.category, 'brand.category');
    if (brand.officialUrl !== null) assertHttpUrl(brand.officialUrl, 'brand.officialUrl');
    if (typeof brand.active !== 'boolean') refuse(`brand.active must be a boolean for ${brand.id}`);
    assertIsoUtcDate(brand.createdAt, 'brand.createdAt');
    assertIsoUtcDate(brand.updatedAt, 'brand.updatedAt');
  }
  return brands;
}

function validateSnapshot(snapshot) {
  assertClosedShape(snapshot, SNAPSHOT_KEYS, 'public snapshot');
  assertIsoUtcDate(snapshot.generatedAt, 'public snapshot.generatedAt', true);
  assertNonEmptyString(snapshot.sourceId, 'public snapshot.sourceId');
  if (snapshot.sourceManifestSha256 !== null && !SHA256.test(snapshot.sourceManifestSha256)) {
    refuse('public snapshot.sourceManifestSha256 must be null or a lowercase SHA-256 hash');
  }
  if (!Array.isArray(snapshot.records)) refuse('public snapshot.records must be an array');
  return snapshot;
}

async function readJson(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CatalogDataRefusal(`${filePath}: invalid JSON (${error.message})`);
  }
}

function validateRecords(records, sources, brands) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const brandById = new Map(brands.map((brand) => [brand.id, brand]));
  const ids = new Set();
  const validated = [];
  for (const record of records) {
    let value;
    try {
      value = validateCatalogRecord(record);
    } catch (error) {
      refuse(`catalog record: ${error.message}`);
    }
    if (ids.has(value.id)) refuse(`duplicate food id ${value.id}`);
    ids.add(value.id);
    const source = sourceById.get(value.sourceId);
    if (!source) refuse(`record ${value.id} references unknown source ${value.sourceId}`);
    const brand = brandById.get(value.brandId);
    if (!brand) refuse(`record ${value.id} references unknown brand ${value.brandId}`);
    if (value.brandName !== brand.name) refuse(`record ${value.id} brandName does not match ${value.brandId}`);
    if (value.sourceType !== source.type) refuse(`record ${value.id} sourceType does not match ${value.sourceId}`);
    if (new URL(value.sourceUrl).hostname !== new URL(source.url).hostname) {
      refuse(`record ${value.id} sourceUrl domain does not match ${value.sourceId}`);
    }
    if (value.sourceType === 'official_brand') {
      if (typeof brand.officialUrl !== 'string') {
        refuse(`official brand ${value.brandId} must have an officialUrl`);
      }
      const officialHostname = new URL(brand.officialUrl).hostname;
      if (
        new URL(source.url).hostname !== officialHostname
        || new URL(value.sourceUrl).hostname !== officialHostname
      ) {
        refuse(`official record ${value.id} source domain must match brand ${value.brandId} officialUrl domain`);
      }
    }
    validated.push(value);
  }
  return validated.toSorted((left, right) => left.id.localeCompare(right.id, 'en'));
}

export async function loadReviewedCatalogFiles(root) {
  assertNonEmptyString(root, 'root');
  const franchiseRoot = path.join(root, 'data', 'franchise');
  const officialRoot = path.join(franchiseRoot, 'official');
  const [sources, brands, publicSnapshot, officialFiles] = await Promise.all([
    readJson(path.join(franchiseRoot, 'sources.json')),
    readJson(path.join(franchiseRoot, 'brands.json')),
    readJson(path.join(franchiseRoot, 'public', 'mfds-franchise.json')),
    readdir(officialRoot, { withFileTypes: true }),
  ]);

  validateSources(sources);
  validateBrands(brands);
  validateSnapshot(publicSnapshot);
  const publicSnapshotSource = sources.find(({ id }) => id === publicSnapshot.sourceId);
  if (!publicSnapshotSource) {
    refuse(`public snapshot references unknown source ${publicSnapshot.sourceId}`);
  }
  const jsonNames = officialFiles
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right, 'en'));
  const officialRecords = await Promise.all(jsonNames.map(async (name) => {
    const value = await readJson(path.join(officialRoot, name));
    if (!Array.isArray(value)) refuse(`official/${name} must be an array`);
    return value;
  }));
  const publicRecords = validateRecords(publicSnapshot.records, sources, brands);
  for (const record of publicRecords) {
    if (record.sourceId !== publicSnapshotSource.id) {
      refuse(
        `public record ${record.id} sourceId must match public snapshot sourceId ${publicSnapshotSource.id}`,
      );
    }
  }
  const records = validateRecords(
    [...officialRecords.flat(), ...publicRecords],
    sources,
    brands,
  );

  return {
    sources: structuredClone(sources).toSorted((left, right) => left.id.localeCompare(right.id, 'en')),
    brands: structuredClone(brands).toSorted((left, right) => left.id.localeCompare(right.id, 'en')),
    records,
    counts: {
      sources: sources.length,
      brands: brands.length,
      foods: records.length,
      officialRecords: records.length - publicRecords.length,
      publicRecords: publicRecords.length,
    },
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function catalogManifest(catalog) {
  assertPlainObject(catalog, 'catalog');
  if (!Array.isArray(catalog.sources) || !Array.isArray(catalog.brands) || !Array.isArray(catalog.records)) {
    refuse('catalog must contain sources, brands, and records arrays');
  }
  const counts = catalog.counts ?? {
    sources: catalog.sources.length,
    brands: catalog.brands.length,
    foods: catalog.records.length,
    officialRecords: catalog.records.filter(({ sourceType }) => sourceType === 'official_brand').length,
    publicRecords: catalog.records.filter(({ sourceType }) => sourceType === 'public_data').length,
  };
  const sha256 = createHash('sha256')
    .update(canonicalJson({ sources: catalog.sources, brands: catalog.brands, records: catalog.records }), 'utf8')
    .digest('hex');
  return { counts, sha256 };
}

async function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = await loadReviewedCatalogFiles(projectRoot);
  const { counts, sha256 } = catalogManifest(catalog);
  process.stdout.write([
    `sources ${counts.sources}`,
    `brands ${counts.brands}`,
    `foods ${counts.foods}`,
    `publicRecords ${counts.publicRecords}`,
    `catalogSha256 ${sha256}`,
    'No issues.',
  ].join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error instanceof CatalogDataRefusal ? 1 : 2;
  });
}
