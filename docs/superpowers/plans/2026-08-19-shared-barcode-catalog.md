# Shared Barcode Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a shared, non-personal barcode catalog that checks reviewed Korean public data before the existing Open Food Facts fallback.

**Architecture:** Measure each external source before parsing it, normalize validated GTINs and nutrition rows into a deterministic catalog snapshot, publish it behind a ready pointer, and expose exact barcode lookup only through an authenticated Cloud Function. The browser never receives service keys and never writes scanned products into the shared catalog.

**Tech Stack:** Vanilla ESM JavaScript, node:test, Firebase Admin/Firestore/Functions/Hosting, existing ZXing-wasm scanner, FoodSafety Korea and data.go.kr public APIs.

**Spec:** `docs/superpowers/specs/2026-08-19-shared-barcode-catalog-design.md`

## Global Constraints

- Do not create a per-user or learned barcode catalog.
- Do not put an API key, raw response, secret-bearing URL, or credential in Git, browser code, Hosting, or logs.
- Do not invent a product identity, nutrient, or serving size.
- Keep absent nutrient fields `null`; never coerce them to zero.
- All production behavior changes start with an observed failing test.
- Network collection defaults to dry-run and publication occurs only after complete validation.
- No new dependency. Use existing Node, Firebase Admin, and repository utilities.
- Work on current `master`; do not commit until the user explicitly requests it.

---

### Task 1: Measure and freeze source contracts

**Files:**
- Create: `scripts/measure-barcode-sources.mjs`
- Create: `tests/barcodeSourceMeasurement.test.js`
- Create: `data/barcode/sources.json`
- Create after successful measurement: `data/barcode/source-profile.json`

**Interfaces:**
- Consumes: secrets from process environment only (`FOODSAFETY_API_KEY`, optional `DATA_GO_KR_KEY`)
- Produces: `measureSource({ sourceId, fetchPage, pageSize, projectRow }) -> profile` and a secret-free deterministic profile. `projectRow(raw)` returns only `{ barcode, name, maker, serving, kcal, carbG, proteinG, fatG }` for counting; raw field names are counted separately.

- [ ] Write a failing test with a paginated fixture requiring exact page count, row count, field-name distribution, barcode-length distribution, missing-field counts, and a malformed-page refusal.
- [ ] Run `node --test tests/barcodeSourceMeasurement.test.js` and verify module-not-found RED.
- [ ] Implement the pure page accumulator and a CLI wrapper that prints only source id, page/row counts, and final profile hash.
- [ ] Run the focused test GREEN.
- [ ] Probe C005 and I2570 using the clipboard key without printing or persisting it. Record only result code, total count, field names, and timing. If the documented service window rejects calls, mark the source `temporarily-unavailable` and continue with other sources without publication.
- [ ] Measure the already identified trace and FoodQR endpoints over all pages twice and require identical profiles.
- [ ] Record source URL, license/reuse statement, retrieval date, and whether redistribution is approved. A source with an unresolved reuse right remains `measurement-only`.

### Task 2: Add canonical GTIN and record validation

**Files:**
- Create: `src/lib/barcodeCatalog.js`
- Create: `tests/barcodeCatalog.test.js`

**Interfaces:**
- Produces:
  - `canonicalCatalogBarcode(value) -> string | null`
  - `normalizeBarcodeCatalogRecord(value) -> CanonicalBarcodeRecord`
  - `chooseBarcodeCandidate(candidates) -> CanonicalBarcodeRecord`
  - `validateBarcodeCatalog(records, manifest) -> { records, manifest }`

- [ ] Write failing tests for valid GTIN-8, UPC-A→EAN-13, EAN-13, leading-zero GTIN-14→EAN-13, nonzero GTIN-14 preservation, invalid check digits, numeric inputs, whitespace/hyphen inputs, and leading-zero loss.
- [ ] Add failing record tests for closed shape, finite nonnegative nutrients, positive serving, `null` preservation, no cross-source nutrient mixing, deterministic order, duplicate identity, same-rank conflict, and source priority.
- [ ] Run `node --test tests/barcodeCatalog.test.js` and verify missing-module RED.
- [ ] Implement the minimal pure functions using the existing barcode check-digit algorithm without changing scanner formats.
- [ ] Run focused GREEN and deliberately mutate one check-digit branch to prove the test fails, then restore it.

### Task 3: Parse each approved source and build the catalog artifact

**Files:**
- Create: `src/lib/barcodeCatalogSources.js`
- Create: `tests/barcodeCatalogSources.test.js`
- Create: `scripts/build-barcode-catalog.mjs`
- Create: `scripts/validate-barcode-catalog.mjs`
- Generate: `data/barcode/barcode-foods.ndjson`
- Generate: `data/barcode/barcode-catalog-manifest.json`
- Generate: `data/barcode/BARCODE_CATALOG_REVIEW.md`

**Interfaces:**
- Produces:
  - `parseTraceRow(row, nutritionIndex) -> candidate | exclusion`
  - `parseFoodQrRow(row, nutrientRows) -> candidate | exclusion`
  - `parseFoodSafetyRow(sourceId, row) -> candidate | exclusion`
  - `buildBarcodeCatalog({ sources, retrievedAt }) -> artifactSet`

- [ ] Derive fixture rows from measured field distributions, redact secret-bearing values, and write failing tests for every observed shape and unit.
- [ ] Run `node --test tests/barcodeCatalogSources.test.js` and verify missing-module RED.
- [ ] Implement one parser at a time, running RED→GREEN for trace, FoodQR, C005, and I2570.
- [ ] Implement the builder as dry-run by default. It must stream pages, keep deterministic ordering, count every exclusion reason, and write only to a fresh external staging path when `--write` is present.
- [ ] Run the complete source dry-run twice and require identical material counts and record hash. `generatedAt` may differ but is excluded from the material hash.
- [ ] Validate the three generated artifacts by rereading them, recomputing every record hash/count, and rejecting extra/missing files.
- [ ] Confirm whether `8801392194078` is present. Report its actual source record or a clean miss; do not add a special case.

### Task 4: Add a fail-closed Firestore import plan

**Files:**
- Create: `functions/import-barcode-catalog.mjs`
- Create: `tests/barcodeCatalogImport.test.js`

**Interfaces:**
- Produces:
  - `buildBarcodeImportPlan(artifactSet, runId) -> batches`
  - `verifyBarcodeImportPlan(plan, artifactSet) -> true`
- Firestore paths:
  - `barcodeCatalogRuns/{runId}`
  - `barcodeCatalogRuns/{runId}/foods/{canonicalBarcode}`
  - `barcodeCatalogState/current`

- [ ] Write failing tests for empty input, one record, 400/401 record batch boundaries, deterministic payload hash, malformed artifact, duplicate path, staging reread drift, Nth-batch failure, and final-pointer failure.
- [ ] Run `node --test tests/barcodeCatalogImport.test.js` and verify missing-module RED.
- [ ] Implement dry-run plan generation and exact artifact reread verification.
- [ ] Implement apply so a run stays non-ready until all food documents and the run manifest exist; update `barcodeCatalogState/current` only in the final transaction.
- [ ] On any failure, leave the previous pointer unchanged and mark no failed run ready.
- [ ] Run focused GREEN. Do not run real `--apply` until Tasks 5–6 and the source review gate pass.

### Task 5: Add shared lookup validation and authenticated Function

**Files:**
- Create: `functions/shared/barcodeCatalog.js`
- Create: `tests/barcodeCatalogLookup.test.js`
- Modify: `functions/index.js`
- Modify: `firebase.json`

**Interfaces:**
- Produces:
  - `queryBarcodeCatalog(db, code) -> CanonicalBarcodeRecord | null`
  - `runBarcodeLookup(code, dependencies) -> { item }`
  - `GET /api/foods/barcode?code=<barcode>`

- [ ] Write failing pure lookup tests for current-pointer absence, ready-run mismatch, exact hit, miss, malformed document, canonical UPC lookup, and Firestore failure.
- [ ] Write a handler fixture proving authentication occurs before query parsing or database access and that response/logs contain no secret/raw fields.
- [ ] Run focused tests and verify RED because the module/handler does not exist.
- [ ] Implement pointer-bound exact lookup and a dependency-injectable handler using the existing `searchFoods` authentication/error conventions.
- [ ] Add the Hosting rewrite for `/api/foods/barcode` without changing search routing.
- [ ] Run focused GREEN and shared-sync/syntax tests.

### Task 6: Lock Firestore access rules

**Files:**
- Modify: `firestore.rules`
- Modify: `tests/firestoreCatalogRules.test.js`

**Interfaces:**
- Browser clients: deny reads/writes to state, runs, food descendants
- Admin SDK: unchanged

- [ ] Write emulator assertions that an authenticated user cannot read or write `barcodeCatalogState/current`, a run manifest, or a food document.
- [ ] Run the rules test under the Firestore emulator and verify RED before the new explicit catalog paths are covered.
- [ ] Add closed deny rules matching the existing franchise catalog pattern.
- [ ] Run emulator GREEN. If Java is unavailable, install nothing silently; use the already reviewed ephemeral JRE procedure and remove it afterward.

### Task 7: Wire shared lookup before OFF and preserve partial data

**Files:**
- Modify: `public/db.js`
- Modify: `public/app.js`
- Modify: `src/lib/barcodeProduct.js`
- Modify: `tests/barcodeProduct.test.js`
- Modify: `tests/uiRedesignShell.test.js`
- Modify: `tests/shellFiles.test.js`
- Modify: `public/sw.js`

**Interfaces:**
- Produces: `lookupBarcode(code) -> { item }`
- Flow: shared catalog hit → existing portion/partial confirmation; shared miss/error → OFF; both miss → current manual path

- [ ] Write failing consumer tests for shared hit without OFF, shared miss then OFF hit, shared 503 then OFF hit, both miss, malformed shared response, and stale scan session.
- [ ] Write a failing partial-nutrition test showing a product with verified kcal and one missing macro is preserved for completion rather than discarded or zero-filled.
- [ ] Run focused tests and verify the current OFF-only/all-four-macros behavior fails them.
- [ ] Implement authenticated `lookupBarcode` in `public/db.js` and dependency-injectable result selection in a pure module if needed.
- [ ] Change `toBarcodeFood` and the existing partial confirmation handoff to retain `null` fields and require explicit completion before a meal entry is saved.
- [ ] Wire the shared-first lookup without changing camera lifecycle or scanner formats.
- [ ] Bump the service-worker revision using `node scripts/bump-shell-revision.mjs` and run shell tests GREEN.

### Task 8: Real data gate, import, deploy, and verify

**Files:**
- Modify: `docs/NEXT.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DECISIONS.md`
- Update: `/Users/jh/Desktop/claude/TODO.md`
- Update after successful deploy: Obsidian `laika/식단앱.md` and `laika/결정기록.md`

**Interfaces:**
- Consumes: fully validated catalog artifacts and import plan
- Produces: ready Firestore catalog and deployed authenticated barcode endpoint/UI

- [ ] Run the builder dry-run twice and compare material counts/hash.
- [ ] Run `npm test`, production `node --check` files, JSON/NDJSON validation, secret-pattern scan, and `git diff --check`.
- [ ] Run importer dry-run and require exact source/count/catalog/payload hashes.
- [ ] Execute one real catalog `--apply`, then independently read the ready pointer and sample/count/hash the published run.
- [ ] Run authenticated emulator rules tests and production direct-read denial probes.
- [ ] Deploy only `firestore:rules`, the barcode Function, and Hosting.
- [ ] Probe known public-source hits, canonical UPC/EAN forms, a clean unknown miss, empty/invalid requests, and `8801392194078`.
- [ ] Verify deployed static module hashes equal local files and existing `/api/foods/search` still passes.
- [ ] Run the full test suite again after deployment. If any test fails, stop without retrying or claiming completion.
- [ ] Record exact counts, hashes, exclusions, source limitations, and the target barcode result in project docs and Obsidian.
