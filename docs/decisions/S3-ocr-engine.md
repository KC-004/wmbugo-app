# S3 — OCR engine choice and the synthetic receipt set

Status: **decided 2026-11-22 (Story 10.1), GATE-05 evidence interim, not signed.** The decision follows the AC rule that an engine failing the denylist is rejected. Several measurements are narrower than the story asked for; section 8 lists each gap, so a later run can close it without redoing the comparison.

**Decision: PaddleOCR PP-OCRv4 (detection and recognition models, Apache-2.0) on ONNX Runtime 1.19.2 (MIT), bundled in the APK.** ML Kit text recognition 16.0.1 (bundled) is rejected: it cannot pass the Story 8.1 dependency denylist with recognition still working.

## 1. What was run

| Item | Value |
|------|-------|
| Device | Xiaomi Redmi Note 11 Pro+ 5G (`2201116SI`, Android 13, arm64), the S8 main reference device, USB-connected |
| Build | `nosms` **debug** (Metro-loaded JS), `arm64-v8a` only. A release build cannot be produced on this PC (Device Guard blocks `hermesc.exe`, S8 and earlier notes), so timings and memory are debug-build numbers |
| Airplane mode | **Not on.** The debug build carries `INTERNET` for Metro. The release-manifest and dependency checks (sections 3 and 4) were run on the `nosms` **release** variant instead |
| Images | 40 synthetic receipts, `fixtures/receipts/synthetic/` (section 2), each read twice per candidate (a warm-up pass and a measured pass) |
| Parser | A throwaway scorer (not committed): lines grouped by block midpoint, total = last amount on a line holding a total keyword, merchant = first three lines, date = the written date. Not the Story 10.2 parser |
| Spike code | Native harness (`OcrSpikeModule`, `PaddleSpike`), model assets and the scorer were removed from the tree after the run; only the `OcrEngine` port and the confirmed fixtures are merged (AC) |

## 2. The synthetic set

`fixtures/receipts/synthetic/` holds 40 images plus a ground-truth JSON each, made by `scripts/gen-synthetic-receipts.mjs` (a seeded generator; it needs `@napi-rs/canvas`, which is not a project dependency). Every merchant, item and number is invented.

- 10 receipts per market group: India (INR), US/Canada (USD), UK/Europe (GBP and EUR), Gulf/SE Asia (AED and SGD).
- Mix: 6 receipts with Devanagari or Arabic text and Western-numeral totals (3 + 3), 5 with decimal commas (EUR), 6 multi-column, 9 low-contrast or tilted (tilt 2 to 4 degrees), 2 long receipts of 32 lines.
- Ground truth: merchant, date, currency, subtotal, taxes, fees, discounts, total and items in minor units. Each one adds up exactly (`packages/core/test/receiptFixtures.test.ts`).
- No real person, card fragment, phone number or loyalty ID: the test rejects 10-digit runs, masked-card patterns and `@`.
- Caveat: these are clean renders. The tilted and low-contrast ones are mild, and no real photo noise (blur, glare, folds, shadows) is present, so accuracy here is an upper bound. A real-receipt check stays with the product owner under PRD 16.3.

## 3. Offline, manifest and denylist (the deciding criterion)

| Check | ML Kit 16.0.1 bundled (`text-recognition` and `text-recognition-devanagari`) | PaddleOCR PP-OCRv4 on ONNX Runtime 1.19.2 |
|-------|------|------|
| Reads with no model download | Yes (bundled artifact, no Play Services model fetch) | Yes (models in assets) |
| Merged `nosms` release manifest, unmodified | Adds `INTERNET`, `ACCESS_NETWORK_STATE`, `MlKitComponentDiscoveryService`, `MlKitInitProvider`, `GoogleApiActivity`, datatransport `TransportBackendDiscovery`, `JobInfoSchedulerService`, `AlarmManagerSchedulerBroadcastReceiver` | Adds nothing; permissions are `USE_BIOMETRIC` and the app's own signature permission |
| Allowlist (`check-permissions.mjs`) | Fails (`INTERNET`, `ACCESS_NETWORK_STATE` present); the two `tools:node="remove"` lines in section 4 remove them (merge accepted, allowlist re-run not repeated) | **Passes** |
| Denylist (`check-dependency-denylist.mjs`) on `nosmsReleaseRuntimeClasspath` | **Fails**: `com.google.android.datatransport:transport-backend-cct`, `transport-runtime`, `transport-api`, and `com.google.firebase:firebase-encoders`, `firebase-encoders-json`, `firebase-components`, `firebase-annotations` | **Passes** (only `com.microsoft.onnxruntime:onnxruntime-android`) |
| Gradle `exclude` of the flagged groups, recognition still working? | Excluding `com.google.firebase` entirely: app crashes at start, `NoClassDefFoundError: com.google.firebase.components.ComponentDiscovery`. Excluding `datatransport` plus `firebase-encoders*`: recognition fails, `NoClassDefFoundError: com.google.android.datatransport.cct.CCTDestination`. | Not needed |
| Verdict | **Rejected** (AC: an engine that cannot pass both checks is rejected) | **Passes both** |

ML Kit's Firebase component-discovery classes and datatransport classes are referenced by its own code, so the exclusions the architecture assumed (AD-14) are not available without replacing those classes. Replacing `datatransport` with a no-op stub library might work, but `firebase-components` cannot be stubbed in a reasonable time and would still trip the denylist. Amending the denylist to allow `firebase-components` and `firebase-annotations` is a policy change for the product owner and was not made here.

## 4. Transitive dependencies (PaddleOCR)

`com.microsoft.onnxruntime:onnxruntime-android:1.19.2` has no Android dependencies beyond the platform: no service, receiver or provider is added to the merged manifest (checked on the release variant), no `INTERNET` and no telemetry component. Nothing needs a `tools:node="remove"` or `exclude`. For the record, the entries that make ML Kit pass the allowlist (but not the denylist) are:

```xml
<uses-permission android:name="android.permission.INTERNET" tools:node="remove" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" tools:node="remove" />
```

## 5. Accuracy against the 40 receipts (throwaway parser, NFR-17 target 90% overall)

| Candidate | Total | Merchant | Date |
|-----------|-------|----------|------|
| ML Kit Latin | 35 / 40 (87.5%) | 34 / 40 | 40 / 40 |
| ML Kit Devanagari | 35 / 40 | 35 / 40 | 29 / 40 |
| **PaddleOCR PP-OCRv4** | **37 / 40 (92.5%)** | 34 / 40 | **40 / 40** |

PaddleOCR per market group (total / merchant / date, out of 10): India 9 / 7 / 10, US-Canada 9 / 10 / 10, UK-Europe 10 / 10 / 10, Gulf-SE Asia 9 / 7 / 10.

- Western-numeral totals on the Arabic and Devanagari receipts: **read** by both engines (the 6 receipts with Devanagari or Arabic text keep their totals; the merchant name in those scripts is not read by the Latin or Chinese-English models). OCR-007 Phase 1 scope (Latin script, Western numerals) is therefore met; reading Arabic or Devanagari words is not needed for it.
- The 3 PaddleOCR total misses (`06-india`, `15-us-canada`, `38-gulf-se-asia-sg`) are tilted or low-contrast receipts where the throwaway grouper merged or split lines. The Story 10.2 parser clusters right-aligned number columns and tolerates a 5 degree slope, so these are expected to improve; they are not engine failures.
- The 6 PaddleOCR merchant misses are exactly the 6 Arabic and Devanagari merchant names; all 34 Latin-script merchants were read.
- **NFR-17 status: not fully met, and not final.** Per field PaddleOCR reads total 92.5% and date 100%, but merchant 85%, because the 6 Arabic and Devanagari merchant names are not read; with all three correct on the same receipt it is 31 of 40 (77.5%; ML Kit Latin 29 of 40). The Phase 1 scope (OCR-007) never uses a non-Latin line as a merchant name, so those 6 are expected misses, and on the 34 receipts with a Latin merchant the joint figure is 31 of 34 (91%). Story 10.2 re-scores with the real parser and its own 90% gate.
- The recognition model used is the Chinese and English PP-OCRv4 one; "PP-OCRv4" in this record means that file.
- ML Kit is faster and equal on accuracy but is rejected on the denylist, not on quality.

## 6. Speed, size and memory (main device only, debug build)

| Candidate | First image | p50 | p95 | Max |
|-----------|-------------|-----|-----|-----|
| ML Kit Latin | 79 ms | 94 ms | 133 ms | 215 ms |
| PaddleOCR | 1,915 ms | 1,975 ms | 3,258 ms | 5,032 ms |

- Added size, `arm64-v8a` (uncompressed): detection model 4.7 MB, recognition model 10.9 MB, `libonnxruntime.so` 17.6 MB, JNI library 0.8 MB, about 34 MB in total; the APK compresses the libraries. Other ABIs add `libonnxruntime.so` of 12.3 MB (`armeabi-v7a`), 20.2 MB (`x86`) and 20.3 MB (`x86_64`).
- **Memory is a concern.** `dumpsys meminfo` after the PaddleOCR pass showed a native heap near 1.0 GB, and the in-process PSS peaked at 1.03 GB. ONNX Runtime's default CPU memory arena keeps what it grabbed, and the detection input is up to 960 px on its long side. Story 10.6 must set `enableCpuMemArena(false)`, limit threads, free the sessions after a scan and re-measure. This number was taken in a debug build with Metro and is not a valid low-end figure.
- p50 of about 2 seconds per image is acceptable for a flow that shows a scan line and a cancel button, but 5 seconds on the longest receipt is slow; run detection at a smaller size and re-measure in 10.6.
- **No budget reference device exists** (S8 lists an emulator as the interim stand-in), so there is no low-end p50, p95 or peak memory.

## 7. Licensing and Play Data safety

| | Licence | Compatible with no data collection |
|--|--|--|
| PaddleOCR (PP-OCRv4 models and code) | Apache-2.0 | Yes: runs locally, no network call in the runtime |
| ONNX Runtime | MIT | Yes |
| RapidOCR ONNX conversions of the PP-OCRv4 models (the files used here, from the `SWHL/RapidOCR` repository) | Apache-2.0 | Yes |
| ML Kit text recognition (rejected) | Google ML Kit terms (proprietary SDK) with Google telemetry libraries inside | Only with the libraries removed, which breaks it (section 3) |

Play Data-safety rationale text for the chosen engine: `Receipt text is read on this phone. No data is collected or shared.` Technical justification: receipts are recognised on the device by PaddleOCR PP-OCRv4 running on ONNX Runtime from model files packaged inside the app; the app declares no `INTERNET` permission and includes no analytics, crash-reporting or transport library, so no receipt image, text or derived data leaves the phone.

## 8. Gaps against the story (not hidden)

1. Only one physical device was used; there is no second reference device and no budget device, so no per-device p50 and p95 beyond the Redmi, and no low-end peak memory.
2. Debug build, not release; airplane mode was not set on the measured run (release manifest and dependency checks were done on the release variant).
3. The throwaway scorer is simpler than the Story 10.2 parser; the accuracy percentages are comparative, not final.
4. Synthetic images are clean renders, so real-photo accuracy is unmeasured.
5. The comparison used the Chinese and English PP-OCRv4 recognition model; Arabic and Devanagari PaddleOCR recognition models exist but were not tried, since the scope needs Western numerals only.
6. Peak memory is high (section 6) and untuned.
7. The model files (15.6 MB) are not committed here. Story 10.6 decides how they are stored (repository, release asset or build download) and records their hashes.
8. The scorer and the native spike harness are not committed (kept in the session scratch only), so the percentages and timings cannot be re-run from the repo; no ML Kit `OcrResult` fixtures were kept. The ML Kit allowlist was not re-run after the two removals.
9. The set has no amounts of 1,000 or more in EUR and none of 100,000 or more in INR, so lakh grouping and a thousands dot beside a decimal comma are not in the images; Story 10.2 covers them with hand-built `OcrResult` cases. It has no `Paid with` line, tips, missing-total or near-duplicate receipts; later stories add what they need.
10. Memory and size have no pass or fail threshold yet: Story 10.6 must bring the native heap well under 1 GB and set the APK size budget, and if PaddleOCR cannot meet it on the low-end device the fallback is DEC-10 (attach a photo, enter by hand).
11. Model files used (SWHL/RapidOCR repository, PP-OCRv4): `ch_PP-OCRv4_det_infer.onnx` SHA-256 d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9 (4,745,517 bytes); `ch_PP-OCRv4_rec_infer.onnx` SHA-256 48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b (10,857,958 bytes).
12. `INTERNET` removal markers: not needed for PaddleOCR; none were left in the manifest.

## 9. Sign-off (GATE-05)

Mobile/OCR engineer sign-off: **pending**. Interim result: PaddleOCR PP-OCRv4 on ONNX Runtime is chosen and the work in Stories 10.2 onward proceeds on it. Benchmarks are provisional until signed here with name and date: `Signed: ____ / ____`.

## 10. What is merged

- `packages/core/src/ports/OcrEngine.ts`: `recognise(image: FileRef, signal: AbortSignal): Promise<OcrResult>`, `OcrResult` (image `width`, `height`, `blocks` of `{ text, box, confidence }`) and the typed failures `OCR_UNAVAILABLE` and `CANCELLED`.
- 40 recorded `OcrResult` fixtures in `packages/core/test/fixtures/receipts/` (from the PaddleOCR pass) for the Story 10.2 and 10.3 parser tests.
- The synthetic images and ground truth in `fixtures/receipts/synthetic/` and their generator.

## 11. Built in Story 10.10 (2026-11-24)

- `apps/mobile/android/app/src/main/java/app/wmbugo/ocr/`: `OcrMath` (detection resize to a multiple of 32 with the long side at most 960, DB box extraction with unclip 1.5, CTC decoding), `PaddleOcr` (two ONNX Runtime sessions: CPU arena allocator off, memory pattern off, two threads, closed after every scan) and `OcrModule` (`WmbugoOcr`, own thread, cancel between lines). The recognition model's own character list (its `character` metadata) is the dictionary.
- Models are not in git. `node scripts/fetch-ocr-models.mjs` downloads them into `apps/mobile/android/app/src/main/assets/ocr/` and checks the SHA-256 values in section 8 (item 11); `--check` only verifies. The build packages them uncompressed. A build made without them reports `OCR_UNAVAILABLE`. A release build must run the script first.
- JVM check (`./gradlew :app:testNosmsDebugUnitTest --tests "app.wmbugo.ocr.*"`): with the real models on 8 synthetic receipts, 133 of 136 recorded lines (97.8%) were read again and the printed total was found in 8 of 8.
- Not measured: on-device speed and native heap with the arena off, a low-end device, and release-build timing (section 8 items 1, 2, 6 and 10 stay open).
