# Franchise Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every validated public-data franchise menu searchable through the existing meal-calendar search flow, with Subway official data as the first curated gap fill.

**Architecture:** Keep Firebase as the only backend. Validate deterministic catalog files locally, import them into Admin-only Firestore collections, then merge Firestore catalog results with the existing live MFDS results inside `searchFoods`. Preserve source provenance and refuse automatic recording when kcal/carbs/protein/fat are incomplete.

**Tech Stack:** Vanilla ESM JavaScript, Node 22 `node:test`, Firebase Admin/Functions v2, Firestore, Firebase Hosting, MFDS public API.

**Spec:** `docs/superpowers/specs/2026-08-18-franchise-catalog-design.md`

## Global Constraints

- Do not put MFDS or other secret keys in browser code.
- Do not invent nutrition numbers; absent source fields remain `null`.
- Do not introduce PostgreSQL, Supabase, a framework, a bundler, or a new runtime dependency.
- Keep existing MFDS, barcode, manual-entry, quick-input, and offline record flows compatible.
- Clients never write `franchiseBrands`, `franchiseFoods`, `nutritionSources`, or `franchiseFoodHistory`.
- Default import behavior is a no-write dry-run; Firestore writes require explicit `--apply`.
- Every production behavior begins with a failing test.
- Do not deploy until focused and full tests, data validation, emulator smoke checks, and diff checks pass.

---

## File Structure

- `src/lib/franchiseCatalog.js`: catalog validation, normalization, search adaptation, and source-aware result merging.
- `functions/shared/franchiseCatalog.js`: deployment copy of the same pure module, guarded by shared-sync tests.
- `tests/franchiseCatalog.test.js`: catalog unit and adversarial tests.
- `data/franchise/sources.json`: reviewed source registry.
- `data/franchise/brands.json`: canonical brands and aliases.
- `data/franchise/official/subway.json`: reviewed Subway official records.
- `data/franchise/public/mfds-franchise.json`: reproducible MFDS franchise snapshot produced by the fetch script.
- `scripts/build-mfds-franchise-data.mjs`: paginated MFDS fetch, filter, canonical serialization, and raw manifest output.
- `scripts/validate-franchise-data.mjs`: zero-write validation entry point.
- `functions/import-franchise-catalog.mjs`: versioned dry-run/apply Firestore importer using Firebase Admin.
- `tests/franchiseCatalogData.test.js`: checked-in data and importer-plan tests.
- `functions/index.js`: Firestore catalog lookup and merge with live MFDS results.
- `public/app.js`: source labels, partial-result explanation, and manual prefill.
- `public/index.html`: approved source and incomplete-nutrition copy bank if static shell coverage requires it.
- `tests/uiRedesignShell.test.js`: UI contract regressions.
- `firestore.rules`: explicit client deny rules for catalog collections.
- `docs/NEXT.md`: deployed behavior, evidence, and remaining physical-device checks.

---

### Task 1: Pure Catalog Contract

**Files:**
- Create: `src/lib/franchiseCatalog.js`
- Create: `tests/franchiseCatalog.test.js`

**Interfaces:**
- Produces: `normalizeCatalogText(value) -> string`
- Produces: `validateCatalogRecord(value) -> frozen canonical record`
- Produces: `catalogRecordToSearchFood(record) -> search food object`
- Produces: `mergeCatalogAndMfdsResults(catalogItems, mfdsItems, query) -> ranked item[]`
- Consumes later: validated JSON records, Function query results, and existing MFDS response items.

- [ ] **Step 1: Write failing normalization and validation tests**

```js
test('normalizes Subway aliases without erasing Korean identity', () => {
  assert.equal(normalizeCatalogText('  서브웨이  Italian B.M.T.™ '), '서브웨이 italian bmt');
});

test('preserves missing nutrients as null and rejects invented or invalid numbers', () => {
  const record = validateCatalogRecord(subwayBmtFixture);
  assert.equal(record.nutrients.kcal, 388);
  assert.equal(record.nutrients.carbG, null);
  assert.throws(
    () => validateCatalogRecord(withNutrient(subwayBmtFixture, 'fatG', -1)),
    /fatG must be null or a finite non-negative number/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/franchiseCatalog.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/lib/franchiseCatalog.js`.

- [ ] **Step 3: Implement closed-shape normalization and validation**

Implement constants for approved source types, confidence values, basis units, nutrient keys, and required keys. Reject unknown keys, non-canonical aliases, duplicate search tokens, invalid URLs, invalid dates, and unsupported units. Return a deep-frozen clone so callers cannot mutate reviewed data.

```js
export function normalizeCatalogText(value) {
  if (typeof value !== 'string') throw new TypeError('normalizeCatalogText: value must be a string');
  return value.normalize('NFC').trim().toLocaleLowerCase('ko-KR')
    .replace(/[™®._-]/g, ' ')
    .replace(/\s+/g, ' ');
}
```

- [ ] **Step 4: Add failing search-adapter tests**

Cover:

- `써브웨이` and `서브웨이` resolve the same BMT record.
- 228g/388kcal converts to the exact 100g compatibility value while null macros remain null.
- non-mass basis is not converted to grams.
- official and public records with the same brand/menu/basis deduplicate to official.
- different serving sizes remain separate.
- deterministic order and input non-mutation.

- [ ] **Step 5: Run the focused test and verify the new assertions fail**

Run: `node --test tests/franchiseCatalog.test.js`

Expected: validation tests PASS; adapter/merge tests FAIL because exports are missing.

- [ ] **Step 6: Implement adapters and merging**

The search object must retain existing compatibility fields and add provenance:

```js
{
  foodKey: `catalog_${record.id}`,
  name: record.name,
  category: record.category,
  maker: record.brandName,
  isFranchise: true,
  per100g: record.basis.unit === 'g' || record.basis.unit === 'mL'
    ? { kcal, carbG, proteinG, fatG }
    : { kcal: null, carbG: null, proteinG: null, fatG: null },
  basis: record.basis.unit,
  servingNutrients: record.nutrients,
  serving: { amount: record.basis.amount, unit: record.basis.unit, source: 'official-serving' },
  completeness: allFourCoreNutrients ? 'complete' : 'partial',
  source: {
    type: record.sourceType,
    label: sourceLabel(record.sourceType),
    url: record.sourceUrl,
    verifiedAt: record.verifiedAt,
  },
}
```

Use an explicit identity key of normalized brand, normalized menu, basis amount, and basis unit. Never merge distinct sizes.
For `개`, `잔`, `조각`, `15cm`, and `30cm`, preserve the official values only in
`servingNutrients`; never expose them through the gram/mL scaling compatibility field.

- [ ] **Step 7: Verify GREEN**

Run: `node --test tests/franchiseCatalog.test.js`

Expected: all tests PASS with zero warnings.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/lib/franchiseCatalog.js tests/franchiseCatalog.test.js
git commit -m "feat: add franchise catalog contracts"
```

---

### Task 2: Reviewed Data Files and Validation CLI

**Files:**
- Create: `data/franchise/sources.json`
- Create: `data/franchise/brands.json`
- Create: `data/franchise/official/subway.json`
- Create: `data/franchise/public/mfds-franchise.json`
- Create: `scripts/validate-franchise-data.mjs`
- Create: `tests/franchiseCatalogData.test.js`

**Interfaces:**
- Consumes: `validateCatalogRecord`, source/brand registries.
- Produces: `loadReviewedCatalogFiles(root) -> { sources, brands, records }`.
- Produces: `catalogManifest(catalog) -> { counts, sha256 }`.
- Produces: canonical ordered records and a SHA-256 manifest printed by `node scripts/validate-franchise-data.mjs`.

- [ ] **Step 1: Write failing checked-in data tests**

```js
test('Subway BMT is bound to the reviewed Korean official page', async () => {
  const records = await loadReviewedCatalogFiles(projectRoot);
  const bmt = records.find(({ id }) => id === 'subway-menu-1528');
  assert.deepEqual(
    pick(bmt, ['brandName', 'name', 'basis', 'nutrients', 'sourceUrl']),
    {
      brandName: '써브웨이',
      name: '이탈리안 비엠티',
      basis: { amount: 228, unit: 'g', label: '1인분' },
      nutrients: {
        kcal: 388, carbG: null, proteinG: 21, fatG: null, sugarG: 8.6, sodiumMg: 1064,
      },
      sourceUrl: 'https://www.subway.co.kr/menuView/sandwich?menuItemIdx=1528',
    },
  );
});
```

Also assert registry references, unique IDs, unique normalized brand aliases, canonical ordering, exact source URL domains, valid dates, and no unreviewed numeric nutrient fields.

- [ ] **Step 2: Run the data test and verify RED**

Run: `node --test tests/franchiseCatalogData.test.js`

Expected: FAIL because the reviewed data files and validation CLI do not exist.

- [ ] **Step 3: Add the source and brand registries**

`sources.json` contains the MFDS dataset/API source and Subway Korea official menu source. `brands.json` contains stable IDs and aliases. Each object is closed-shape and canonically sorted by ID.

- [ ] **Step 4: Add the first official Subway record**

Encode only values visible on the official Korean page: 228g, 388kcal, 21g protein, 8.6g sugar, 1064mg sodium. Keep total carbs and total fat null. Include the official URL and `verifiedAt: 2026-08-18T00:00:00.000Z`.

- [ ] **Step 5: Implement the zero-write validator**

The CLI loads every JSON file, validates registry references and every record, sorts records by ID, computes SHA-256 over canonical UTF-8 JSON, and prints:

```text
sources N
brands N
foods N
catalogSha256 <64 lowercase hex>
No issues.
```

It exits `0` when clean, `1` for data refusal, and `2` for CLI/I/O failure. It never writes files.

- [ ] **Step 6: Add an empty canonical public snapshot**

Before the MFDS fetch task runs, `mfds-franchise.json` is the exact reviewed envelope:

```json
{"generatedAt":null,"sourceId":"mfds-franchise","sourceManifestSha256":null,"records":[]}
```

The validator accepts this bootstrap envelope but reports `publicRecords 0`; deployment completion later requires the populated form.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
node --test tests/franchiseCatalogData.test.js
node scripts/validate-franchise-data.mjs
```

Expected: tests PASS; CLI exit 0 and `No issues.`.

- [ ] **Step 8: Commit Task 2**

```bash
git add data/franchise scripts/validate-franchise-data.mjs tests/franchiseCatalogData.test.js
git commit -m "feat: add reviewed franchise catalog data"
```

---

### Task 3: Reproducible MFDS Franchise Snapshot

**Files:**
- Create: `scripts/build-mfds-franchise-data.mjs`
- Modify: `tests/franchiseCatalogData.test.js`
- Replace generated content: `data/franchise/public/mfds-franchise.json`

**Interfaces:**
- Consumes: `MFDS_API_KEY`, official `FoodNtrCpntDbInfo02` endpoint, existing `parseMfdsFoodItem`.
- Produces: canonical `mfds-franchise.json` containing only records whose reviewed raw origin code is `FOOD_OR_CD === '2'`.

- [ ] **Step 1: Write failing fetch-plan and canonicalization tests**

Extract pure helpers from the script for tests:

```js
export function buildMfdsPages(totalCount, rowsPerPage)
export function toPublicCatalogRecord(rawItem, generatedAt)
export function canonicalSnapshot(records, metadata)
```

Test zero items, one page, exact page boundary, multiple pages, duplicate `FOOD_CD`, non-franchise exclusion, malformed items, stable ID, and deterministic ordering.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/franchiseCatalogData.test.js`

Expected: new imports fail because the snapshot builder does not exist.

- [ ] **Step 3: Implement paginated fetch and strict filtering**

Require `MFDS_API_KEY`; decode it exactly as `functions/index.js` does. Request JSON pages with a fixed `numOfRows` of 100. Stop only when the collected raw record count reaches `totalCount`. Abort each request after 8 seconds. A failed or malformed page aborts the entire build; do not publish a partial snapshot.

- [ ] **Step 4: Implement exclusive output publication**

Default mode prints the planned record count/hash and does not change the checked-in snapshot. `--write` writes to an exclusive sibling temporary file, fsyncs it, refuses to overwrite a concurrently changed destination, and renames only after the complete canonical payload is ready.

- [ ] **Step 5: Verify the builder tests GREEN**

Run: `node --test tests/franchiseCatalogData.test.js`

Expected: all tests PASS.

- [ ] **Step 6: Run the real read-only fetch**

Run: `node scripts/build-mfds-franchise-data.mjs`

Expected: exit 0; nonzero franchise count; no destination modification; no key printed.

- [ ] **Step 7: Review licensing and write the snapshot**

Confirm the dataset page license and third-party-rights conditions documented in `sources.json`. Then run:

```bash
node scripts/build-mfds-franchise-data.mjs --write
node scripts/validate-franchise-data.mjs
```

Expected: nonzero `publicRecords`, canonical hash, and `No issues.`. If licensing cannot be confirmed, stop before `--write` and report the blocker; do not substitute another dataset.

- [ ] **Step 8: Commit Task 3**

```bash
git add scripts/build-mfds-franchise-data.mjs tests/franchiseCatalogData.test.js data/franchise/public/mfds-franchise.json data/franchise/sources.json
git commit -m "feat: build MFDS franchise catalog snapshot"
```

---

### Task 4: Admin-Only Firestore Importer

**Files:**
- Create: `functions/import-franchise-catalog.mjs`
- Create: `functions/shared/franchiseCatalog.js`
- Modify: `scripts/check-shared-sync.mjs`
- Modify: `tests/sharedSync.test.js`
- Modify: `tests/franchiseCatalogData.test.js`
- Modify: `firestore.rules`

**Interfaces:**
- Consumes: validated catalog files and `validateCatalogRecord`.
- Produces: `buildCatalogImportPlan(currentPointer, reviewedCatalog, runId)` and CLI dry-run/apply behavior.
- Produces Firestore paths: `franchiseCatalogRuns/{runId}/{brands|foods|sources}/{id}` and
  `franchiseCatalogState/current`.

- [ ] **Step 1: Add the shared-module sync test and verify RED**

Add `franchiseCatalog.js` to the same byte-exact source/function shared-module contract used by existing parser/search modules.

Run: `node --test tests/sharedSync.test.js`

Expected: FAIL because `functions/shared/franchiseCatalog.js` is missing.

- [ ] **Step 2: Copy the reviewed pure module and verify shared GREEN**

Run:

```bash
cp src/lib/franchiseCatalog.js functions/shared/franchiseCatalog.js
node --test tests/sharedSync.test.js
```

Expected: PASS and sync checker exit 0.

- [ ] **Step 3: Write failing import-plan tests**

Cover first run, unchanged manifest, changed manifest, stable run IDs, deterministic staging batches, duplicate IDs,
pointer drift, failed middle staging batch, verification count/hash mismatch, and input non-mutation. A new run must
never become current until every staged document and the run manifest have been re-read and verified.

- [ ] **Step 4: Run importer tests and verify RED**

Run: `node --test tests/franchiseCatalogData.test.js`

Expected: FAIL because `buildCatalogImportPlan` is not exported.

- [ ] **Step 5: Implement importer planning and dry-run**

Default execution reads the current pointer and reviewed files, produces exact source/brand/food counts, run ID,
and payload hashes, then exits without writes. `--apply` creates a new `status: staging` run and writes its
subcollections in batches of at most 400 operations. It then re-reads every staged document and verifies exact
counts and canonical hash, marks the run `ready`, and uses a Firestore transaction to change
`franchiseCatalogState/current` only if the pointer still equals the preflight value. A failed or drifting staging
run remains unreferenced and is never visible to search.

- [ ] **Step 6: Add explicit Firestore client-deny rules**

Add closed rules for catalog state and all versioned runs:

```text
match /franchiseCatalogState/{id} { allow read, write: if false; }
match /franchiseCatalogRuns/{runId} {
  allow read, write: if false;
  match /{document=**} { allow read, write: if false; }
}
```

Admin SDK remains able to import and the authenticated Function remains the only reader exposed to the app.

- [ ] **Step 7: Verify importer and rules behavior**

Run the focused tests and Firebase emulator rules tests already used by the repository. If no catalog rules harness exists, add a minimal emulator test proving authenticated client reads and writes are denied; do not claim rule verification from textual inspection alone.

- [ ] **Step 8: Commit Task 4**

```bash
git add functions/import-franchise-catalog.mjs functions/shared/franchiseCatalog.js scripts/check-shared-sync.mjs tests/sharedSync.test.js tests/franchiseCatalogData.test.js firestore.rules
git commit -m "feat: add safe franchise catalog importer"
```

---

### Task 5: Merge Catalog Results in `searchFoods`

**Files:**
- Modify: `functions/index.js`
- Modify: `functions/shared/franchiseCatalog.js`
- Modify: `src/lib/franchiseCatalog.js`
- Modify: `tests/franchiseCatalog.test.js`
- Create: `tests/franchiseSearchFunction.test.js`

**Interfaces:**
- Consumes: `queryCatalogFoods(db, query, limit = 100)` and existing MFDS results.
- Produces: authenticated `/api/foods/search` response with merged `items`, `hasMore`, and per-source availability flags.

- [ ] **Step 1: Write failing query-plan tests**

Test `써브웨이`, `서브웨이`, `서브웨이 이탈리안BMT`, exact menu-only, empty query, and a brand-only result set over 100. Assert one strongest token query, in-memory all-token filtering, and `hasMore` behavior.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/franchiseCatalog.test.js tests/franchiseSearchFunction.test.js`

Expected: FAIL because catalog query orchestration is absent.

- [ ] **Step 3: Implement catalog Firestore lookup**

Read `franchiseCatalogState/current`, verify that its referenced run is `ready` with matching manifest metadata,
then query that run's `foods` subcollection with
`where('searchTokens', 'array-contains', strongestToken).limit(101)`. Filter inactive and nonmatching records in
memory, validate every returned record, convert to search foods, and set `hasMore` if more than 100 match. A
missing pointer, non-ready run, metadata mismatch, or malformed record is a catalog-source failure, not a silently
skipped item.

- [ ] **Step 4: Add source-isolation tests**

Test:

- catalog success + MFDS success merges deterministically;
- catalog success + MFDS total failure returns catalog results and `mfdsUnavailable: true`;
- catalog failure + MFDS success returns MFDS results and `catalogUnavailable: true`;
- both fail returns 502;
- cache write failure does not erase results;
- official BMT beats any duplicate public BMT record.

- [ ] **Step 5: Implement source-isolated merging in `functions/index.js`**

Start both lookups concurrently after authentication. Preserve the existing `attempts` and `skipped` fields and add availability flags only when true. Cache only validated items. Do not query Firestore from the browser.

- [ ] **Step 6: Verify focused and Functions syntax**

Run:

```bash
node --test tests/franchiseCatalog.test.js tests/franchiseSearchFunction.test.js
node --check functions/index.js
node --check functions/shared/franchiseCatalog.js
```

Expected: PASS, zero failures.

- [ ] **Step 7: Commit Task 5**

```bash
git add functions/index.js functions/shared/franchiseCatalog.js src/lib/franchiseCatalog.js tests/franchiseCatalog.test.js tests/franchiseSearchFunction.test.js
git commit -m "feat: merge franchise catalog search results"
```

---

### Task 6: Source-Aware and Partial-Nutrition UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `tests/uiRedesignShell.test.js`
- Modify: `tests/franchiseCatalog.test.js`

**Interfaces:**
- Consumes: merged search food objects with `completeness` and `source`.
- Produces: exact result labels, partial-value prefill, and no automatic save until four core nutrients are numeric.

- [ ] **Step 1: Write failing static and pure behavior tests**

Assert exact visible copy:

```text
공식값
공공데이터
참고값
공식 자료에 없는 탄수화물·지방은 직접 입력해야 합니다.
검색 결과가 많습니다. 브랜드와 메뉴명을 함께 입력해 주세요.
```

Assert BMT renders `써브웨이 · 공식값 · 1인분 228g · 388kcal` and never renders null carbs/fat as zero.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/uiRedesignShell.test.js tests/franchiseCatalog.test.js`

Expected: FAIL for missing source labels and partial-result UI branch.

- [ ] **Step 3: Implement result rendering**

Render source labels from the response; do not infer them from `isFranchise`. For catalog results, show official serving kcal rather than misleading `100g당` copy when the source basis is a serving. Add safe external source links with `target="_blank" rel="noopener noreferrer"`.

- [ ] **Step 4: Implement partial-result selection**

Reuse `fillManualEntry(food, amount, scaled)`. Prefill only numeric values. Show the exact incomplete-data explanation with the missing field names. Keep `addSearchedFood` automatic-save guard unchanged so any null core nutrient returns `false`.

When the user supplies missing values, store field provenance:

```js
nutritionProvenance: {
  kcal: 'official_brand',
  proteinG: 'official_brand',
  carbG: 'manual',
  fatG: 'manual',
  sourceUrl,
  verifiedAt,
}
```

Existing entries without this field remain valid.

- [ ] **Step 5: Verify focused tests GREEN**

Run: `node --test tests/uiRedesignShell.test.js tests/franchiseCatalog.test.js`

Expected: all PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: all tests PASS; no shared-sync failures.

- [ ] **Step 7: Commit Task 6**

```bash
git add public/app.js public/index.html tests/uiRedesignShell.test.js tests/franchiseCatalog.test.js
git commit -m "feat: show franchise source and missing nutrients"
```

---

### Task 7: Import, Smoke Test, Deploy, and Document

**Files:**
- Modify: `docs/NEXT.md`
- Modify only if generated hashes changed: `data/franchise/public/mfds-franchise.json`

**Interfaces:**
- Consumes: reviewed catalog, importer, Functions and Hosting changes.
- Produces: deployed searchable catalog and recorded verification evidence.

- [ ] **Step 1: Rebuild and validate the exact catalog**

Run:

```bash
node scripts/build-mfds-franchise-data.mjs
node scripts/validate-franchise-data.mjs
npm test
git diff --check
```

Expected: nonzero public franchise count, one or more official records, `No issues.`, all tests PASS, diff check exit 0.

- [ ] **Step 2: Run Firestore import dry-run**

Run from the configured Firebase project environment:

```bash
node functions/import-franchise-catalog.mjs
```

Expected: exact create/update/deactivate/history counts and payload hashes; Firestore writes 0.

- [ ] **Step 3: Review import scope and apply once**

Confirm the dry-run count equals the validated source file count. Then run exactly once:

```bash
node functions/import-franchise-catalog.mjs --apply
```

Expected: imported count equals planned count; no drift refusal; no partial batch failure.

- [ ] **Step 4: Run local emulator smoke checks**

Use a temporary authenticated user and verify:

- `써브웨이` and `서브웨이` return the same BMT food key;
- BMT values and source URL match the reviewed data;
- missing carbs/fat opens manual completion and does not auto-save;
- a known MFDS general food remains searchable;
- malformed/unknown query remains safely handled.

Delete the temporary user after the probe.

- [ ] **Step 5: Deploy Functions and Hosting**

Run:

```bash
firebase deploy --only functions:searchFoods,hosting
```

Do not deploy Firestore rules unless the emulator rule test from Task 4 passed. If it passed and rules changed, use:

```bash
firebase deploy --only firestore:rules,functions:searchFoods,hosting
```

- [ ] **Step 6: Run deployed authenticated probes**

Verify HTTP 200 and exact behavior for:

- `서브웨이 이탈리안BMT`
- `써브웨이`
- `맥도날드 빅맥`
- one general Korean food

Confirm Hosting serves the new `app.js`, the UI source label appears, and Functions logs contain no validation or catalog-query error. Delete the temporary auth user.

- [ ] **Step 7: Update `docs/NEXT.md` with measured facts**

Record exact catalog counts, source hashes, test count, deployed query outcomes, deploy URL, incomplete-nutrient behavior, and any physical-device checks still outstanding. Remove stale text claiming all franchise searches necessarily return zero.

- [ ] **Step 8: Commit final evidence**

```bash
git add docs/NEXT.md data/franchise/public/mfds-franchise.json
git commit -m "docs: record franchise catalog deployment"
```

- [ ] **Step 9: Push only after final verification**

Run:

```bash
git status --short --branch
git log -8 --oneline
git push origin master
```

Expected: clean worktree, local `master` matches `origin/master`, deployed probes remain green.

---

## Final Verification Checklist

- [ ] `node scripts/validate-franchise-data.mjs` exits 0 with nonzero public franchise records.
- [ ] `npm test` reports zero failures.
- [ ] `node --check` passes for every changed production and script module.
- [ ] `git diff --check` exits 0.
- [ ] Import dry-run count exactly matches apply count.
- [ ] Catalog collections reject direct authenticated client reads and writes.
- [ ] `써브웨이` and `서브웨이` resolve the same official BMT record.
- [ ] BMT shows 228g, 388kcal, protein 21g, null carbs, and null fat.
- [ ] Partial records cannot auto-save with invented zeroes.
- [ ] MFDS general-food and barcode paths still work.
- [ ] Deployed authenticated probes and Functions logs are clean.
- [ ] Worktree is clean and remote commit equals deployed commit.
