# Franchise Search and Barcode Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore confidence in deployed franchise search and add a complete iOS-safe barcode scan-to-food flow without inventing nutrition values.

**Architecture:** Diagnose the MFDS boundary before changing it. Keep barcode parsing and product conversion in pure `src/lib` modules, while camera lifecycle, lazy ZXing loading, OFF fetch, and existing screen orchestration stay in `public/app.js`.

**Tech Stack:** Vanilla ESM JavaScript, node:test, Firebase Hosting/Functions, Open Food Facts API v2, zxing-wasm 3.1.3 reader IIFE.

**Spec:** `docs/superpowers/specs/2026-08-18-franchise-barcode-completion-design.md`

## Global Constraints

- Do not expose MFDS or other secret keys to browser code.
- Do not invent nutrition values or serving sizes.
- Do not add a framework, bundler, or unpinned external dependency.
- Preserve all current user changes and unrelated dirty files.
- Every production behavior change starts with a failing test.

---

### Task 1: Diagnose the deployed franchise-search boundary

**Files:**
- Inspect: `functions/index.js`
- Inspect: `scripts/verify-mfds.mjs`
- Append evidence: `docs/NEXT.md`

**Interfaces:**
- Consumes: authenticated Hosting rewrite `/api/foods/search?q=...`
- Produces: a root-cause classification and an exact fix only if a code/config cause is reproduced

- [ ] Run `node scripts/verify-mfds.mjs 김밥` and retain count/timing evidence.
- [ ] Create a temporary anonymous Firebase session using the public Web SDK key, call the authenticated Hosting route once, and delete that temporary auth user in the same script.
- [ ] Correlate the request with `firebase functions:log --only searchFoods`.
- [ ] If the deployed request succeeds, record the prior incident as transient and make no speculative timeout change.
- [ ] If it fails, write the smallest failing test around the observed boundary before changing `functions/index.js`.
- [ ] Re-run the authenticated deployed probe after any fix.

### Task 2: Harden OFF parsing

**Files:**
- Modify: `tests/offParser.test.js`
- Modify: `src/lib/offParser.js`

**Interfaces:**
- Consumes: OFF v2 product response
- Produces: `parseOffProduct(response)` that treats a missing `nutriments` object as four missing nutrients

- [ ] Add a test using a status-1, `nutrition_data_per: '100g'` product with no `nutriments` property and expect all four `per100` values to be `null`.
- [ ] Run `node --test tests/offParser.test.js` and verify the existing `Object.hasOwn` TypeError.
- [ ] Change the parser to use an empty object only when the whole `nutriments` field is nullish; keep malformed present values rejected.
- [ ] Re-run the focused test and then `npm test`.

### Task 3: Add pure barcode product adapters

**Files:**
- Create: `src/lib/barcodeProduct.js`
- Create: `tests/barcodeProduct.test.js`

**Interfaces:**
- Produces: `normalizeRetailBarcode(results)`, `buildOpenFoodFactsUrl(barcode)`, `toBarcodeFood(parsed)`
- Consumes later: scanner results and `parseOffProduct` output

- [ ] Write tests for empty results, unsupported formats, EAN13/EAN8/UPCA/UPCE, first valid result, input validation, URL encoding, g/ml conversion, missing nutrition, and source/barcode preservation.
- [ ] Run the focused tests and verify missing-module RED.
- [ ] Implement only the three pure functions with closed validation and no DOM/network imports.
- [ ] Run focused tests GREEN and full tests.

### Task 4: Add the static barcode scanner shell

**Files:**
- Modify: `public/index.html`
- Modify: `tests/uiRedesignShell.test.js`

**Interfaces:**
- Produces DOM ids: `barcodeOpen`, `barcodeScanner`, `barcodeVideo`, `barcodeCanvas`, `barcodeStatus`, `barcodeCancel`

- [ ] Add shell tests for the exact approved Korean copy and required camera elements.
- [ ] Run the focused shell test and verify RED.
- [ ] Add the button and scanner panel inside the existing add sheet without changing unrelated layouts.
- [ ] Run the focused test GREEN.

### Task 5: Wire camera lifecycle, ZXing, OFF lookup, and existing add flow

**Files:**
- Modify: `public/app.js`
- Modify: `public/sw.js`
- Modify: `tests/shellFiles.test.js`
- Modify: `tests/uiRedesignShell.test.js`

**Interfaces:**
- Consumes: Task 3 pure adapters, Task 4 DOM ids, `parseOffProduct`
- Produces: `startBarcodeScanner()` and `stopBarcodeScanner()` behavior inside the app module

- [ ] Add static and source-contract tests that require the pinned reader URL, retail formats, track shutdown paths, and all new local imports in the service-worker shell.
- [ ] Run focused tests and verify RED.
- [ ] Lazy-load `https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/iife/reader/index.js` only after the user taps the button.
- [ ] Start the environment-facing camera, copy ready video frames to canvas, and allow only one in-flight `readBarcodes` call per animation frame.
- [ ] Stop every media track on success, cancel, error, add-sheet close, and `visibilitychange` hidden.
- [ ] Fetch OFF directly, parse it, route a usable product through the existing serving/add-success flow, and route missing data to manual input without nutrition values.
- [ ] Increment the service-worker cache name and include new local imports.
- [ ] Run focused and full tests.

### Task 6: Verify, document, commit, and deploy

**Files:**
- Modify: `docs/NEXT.md`
- Modify: `docs/orders/QUEUE.md`
- Include existing Task 28 files in the barcode commit

**Interfaces:**
- Produces: audited Git commits and deployed Hosting; Functions only if Task 1 changed them

- [ ] Run `npm test`, `node --check` on changed production files, and `git diff --check`.
- [ ] Confirm `.env`, `.firebase`, logs, and personal data are not staged.
- [ ] Commit the MFDS fix separately if one exists.
- [ ] Commit OFF parser + barcode flow + Task 28 docs/assets as one reviewed feature commit.
- [ ] Deploy Hosting; deploy `searchFoods` only if its production source changed.
- [ ] Verify Hosting root/static assets and unauthenticated 401 behavior.
- [ ] Record iPhone camera permission and real-package barcode checks as user-required when no physical iPhone is available.
