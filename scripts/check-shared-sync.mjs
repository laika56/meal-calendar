import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';

const sharedDir = new URL('../functions/shared/', import.meta.url);
const sourceDir = new URL('../src/lib/', import.meta.url);
const fixCommand = 'node scripts/check-shared-sync.mjs --fix';
const shouldFix = process.argv.slice(2).includes('--fix');
const requiredSharedFiles = [
  'barcodeCatalogLookup.js',
  'franchiseCatalog.js',
  'mfdsParser.js',
  'searchPlan.js',
  'searchResults.js',
];
let hasFailure = false;
let hasContentMismatch = false;

if (!existsSync(sharedDir)) {
  console.log('✅ 검사할 복사본이 없다');
  process.exit(0);
}

const sharedFiles = readdirSync(sharedDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();

if (sharedFiles.length === 0) {
  console.log('✅ 검사할 복사본이 없다');
  process.exit(0);
}

for (const filename of requiredSharedFiles) {
  if (!sharedFiles.includes(filename)) {
    if (shouldFix) {
      const sourcePath = new URL(encodeURIComponent(filename), sourceDir);
      if (!existsSync(sourcePath)) {
        console.error(`❌ ${filename} — src/lib 원본이 없다`);
        process.exit(1);
      }
      copyFileSync(sourcePath, new URL(encodeURIComponent(filename), sharedDir));
      sharedFiles.push(filename);
      sharedFiles.sort();
      console.log(`✅ ${filename}`);
      continue;
    }
    console.error(`❌ ${filename} — functions/shared 복사본이 없다`);
    hasFailure = true;
  }
}

for (const filename of sharedFiles) {
  const sharedPath = new URL(encodeURIComponent(filename), sharedDir);
  const sourcePath = new URL(encodeURIComponent(filename), sourceDir);

  if (!existsSync(sourcePath)) {
    console.error(`❌ ${filename} — src/lib 원본이 없는 고아 복사본이다`);
    hasFailure = true;
    continue;
  }

  if (readFileSync(sharedPath).equals(readFileSync(sourcePath))) {
    console.log(`✅ ${filename}`);
    continue;
  }

  if (shouldFix) {
    copyFileSync(sourcePath, sharedPath);
    console.log(`✅ ${filename}`);
    continue;
  }

  console.error(`❌ ${filename} — 내용이 다르다`);
  hasFailure = true;
  hasContentMismatch = true;
}

if (hasContentMismatch) {
  console.error(`수정하려면 실행: ${fixCommand}`);
}

process.exit(hasFailure ? 1 : 0);
