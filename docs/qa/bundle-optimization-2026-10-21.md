# TOKOLINK bundle optimization — 2026-10-21

## Measured change

Compared with local commit `8b8a5bb`, using the unchanged `scripts/check-bundle-size.mjs` on a production Vite build:

| Aggregate gzip metric |      Before |     After | Existing budget |
| --------------------- | ----------: | --------: | --------------: |
| All client assets     | 1,084.1 KiB | 970.4 KiB |         950 KiB |
| JavaScript            | 1,046.2 KiB | 932.5 KiB |         800 KiB |
| CSS                   |    19.2 KiB |  19.2 KiB |          40 KiB |

**113.7 KiB less JavaScript (~10.9%). The bundle gate still fails.** Remaining excess: 20.4 KiB total and 132.5 KiB JavaScript. This gate counts all client chunks, including lazy routes; this is not an initial-page transfer or Android timing measurement. Budgets and gate implementation are unchanged.

## Implementation

- Keep calls lazy-loaded through a named-export adapter exposing the same `Room`, `RoomEvent`, `Track`, and `VideoPresets` implementations. Full-build SDK chunk shrinks from 132.2 to 122.3 KiB gzip. Media presets, codecs, reconnection, security and compatibility code used by `Room` remain upstream implementations.
- Keep PDF exports lazy-loaded through a named `jsPDF` adapter.
- Follow installed jsPDF's documented **Optional dependencies** guidance: omit unused `canvg`, `html2canvas`, and `dompurify` imports originating inside jsPDF. These support HTML/SVG rendering; neither existing exporter invokes those APIs. Calls export draws text/tables; ledger draws text/tables, a real PNG QR and opacity watermark. All dependencies used for these features remain bundled.
- The exclusion is importer-scoped: another application feature importing any of these libraries still receives its real bundled implementation. No empty modules, renderer substitutes, CDN imports, custom jsPDF source extraction, or package/lockfile changes.
- Adding HTML/SVG PDF output later requires restoring its optional dependency and updating the regression fixtures. The current export API usage guard protects the inspected set of methods.

## Verification

- Offline full suite: **749 passed, 62 skipped** (86 files passed, one skipped). Existing live-check gates were not weakened.
- TypeScript, production build and `git diff --check`: passed.
- ESLint: zero errors, 34 existing warnings.
- Fresh registry advisory audit: zero vulnerabilities across 770 packages.
- Real jsPDF/QR functional tests cover empty, small and multipage exports, repeated headers, PNG QR, opacity watermark, filenames and receipt footers. A reviewed method allowlist guards accidental HTML/SVG PDF API additions.
- Supplemental Node-generated PDF comparison: six fixtures, ten rasterized pages, zero pixel differences. Real CUA Chromium validation also passed: **nine PDFs / thirteen pages**, 96 DPI, zero raster differences, zero browser errors/CSP violations/external resources. Includes empty/small/multipage exports, payable/unpaid/paid ledger variants and Arabic text parity. The actual production jsPDF chunk imported and generated a PDF successfully without resolving excluded optional renderer imports. Evidence summary: `bundle-optimization-2026-10-21-pdf.json`.

Commands:

```sh
./node_modules/.bin/vite build
node scripts/check-bundle-size.mjs
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint .
/tmp/mcm-bin/bun audit
SUPABASE_URL= SUPABASE_PUBLISHABLE_KEY= VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= VITE_SUPABASE_ANON_KEY= LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN= ./node_modules/.bin/vitest run
```

## Remaining constraints

A fresh advisory audit reports zero vulnerabilities across 770 packages; this used the official registry only, not application backends. No production database, real call, authenticated application E2E or Android performance measurement was run.

Further large savings were investigated rather than silently removing features:

- jsQR's ~49.5 KiB contains the actual fallback decoder and encoding tables. Replacing it with browser-native detection alone would remove supported-device fallback.
- LiveKit's remaining SDK implements used real-time communication features; no safe feature-preserving 132.5 KiB reduction was identified.
- A custom jsPDF sourcemap/module extraction was considered and rejected because it introduces maintenance and security-update coupling. The final implementation uses the supported package unchanged.
- More chunk splitting does not reduce the aggregate gate. Meeting the remaining JS target needs a separately designed, feature-equivalent library replacement or broader architecture change with product/browser coverage, not a threshold increase or a relabeled measurement.

These local changes are ready for review. Publication/deployment is managed separately; no remote branch or production changes were made in this task.

Browser fixture reproduction:

```sh
node --experimental-strip-types scripts/build-pdf-regression.ts
python3 e2e/pdf_exports.py
```

For the CUA/manual-browser alternative, use `e2e/pdf_exports_cua.py` with `PDF_BROWSER_OUTPUT` set to a shared workspace directory; its header documents serving the fixtures and running `--compare`.

The standard Playwright launch is sandbox-blocked in this task runner. The successful run used CUA's already-available Chromium with a localhost-only fixture server started through the native terminal, CSP forbidding non-local requests, and the same generated baseline/candidate bundles. Full browser PDFs and raster evidence: `/workspace/scratch/e3d265d677b4/pdf-browser-validation/`. This is offline PDF validation, not an authenticated application or real Android test.
