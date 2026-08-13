import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sharedDir = join(projectRoot, 'functions', 'shared');
const sourceDir = join(projectRoot, 'src', 'lib');
const fixCommand = 'node scripts/check-shared-sync.mjs --fix';

test('functions/shared copies match their src/lib originals', async (t) => {
  if (!existsSync(sharedDir)) return;

  const sharedFiles = readdirSync(sharedDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  for (const filename of sharedFiles) {
    await t.test(filename, () => {
      const sharedPath = join(sharedDir, filename);
      const sourcePath = join(sourceDir, filename);
      const message = `${filename}: functions/shared 복사본이 src/lib 원본과 다릅니다. ${fixCommand}`;

      assert.strictEqual(existsSync(sourcePath), true, message);
      assert.strictEqual(
        readFileSync(sharedPath).equals(readFileSync(sourcePath)),
        true,
        message,
      );
    });
  }
});
