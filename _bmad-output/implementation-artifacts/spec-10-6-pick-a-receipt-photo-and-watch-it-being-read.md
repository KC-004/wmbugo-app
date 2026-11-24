---
title: 'Pick a receipt photo and watch it being read'
type: 'feature'
created: '2026-11-24'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3111f7a'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A receipt can be read in core and reviewed (10.4), but nothing takes a photo in, runs the engine or shows the wait.

**Approach:** A `Snap receipt` chip on the Expense form opens the Photo Picker; the photo is taken in as one processed, encrypted copy, read through the `OcrEngine` adapter under a scan-line loader with Cancel, and opens the review with the photo as its attachment. Failures offer Try again and Enter it by hand.

## Boundaries & Constraints

**Always:** the original is never copied; nothing but the one processed copy is written until Save; Cancel, Back and failure paths delete that copy (except Enter it by hand, which keeps it for the typed entry); no permission is asked for the picker.

**Never:** invent text when no engine exists; download a model; add INTERNET or an analytics library.

</frozen-after-approval>

## Code Map

- `apps/mobile/android/.../ReceiptFilesModule.kt` -- `prepareReceiptImage` (EXIF orientation, 2,048 px, JPEG 85, no EXIF, encrypt, digest)
- `apps/mobile/src/adapters/files/receiptFiles.ts` -- `PendingPhoto`, `ReceiptScanFiles`, `realScanFiles`
- `apps/mobile/src/adapters/ocr/ocrEngine.ts` -- `createOcrEngine` over native `WmbugoOcr`; absent module gives `OCR_UNAVAILABLE`
- `apps/mobile/src/features/receipt/receiptScanApi.ts` -- `intakePhoto` (digest dedupe), `readPhoto` (20 s limit, cancel)
- `apps/mobile/src/features/receipt/ReceiptScanScreen.tsx`, `shared/brand/ScanLoader.tsx` -- loader, item reveal, error states
- `features/add/AddSheet.tsx`, `addApi.ts`, `useOpenAdd.tsx`, `shell/RootNavigator.tsx` -- chip, `preset.photo`, `ReceiptScan` route
- `ReceiptReviewScreen.tsx` -- `photo` saved as the attachment, `onDiscardPhoto`

## Tasks & Acceptance

**Execution:**
- [x] Native intake, engine adapter, scan service, loader and screen, Add chip, route, review photo, tests

**Acceptance Criteria:**
- Given a chosen photo, then one processed encrypted copy exists, a photo already saved shows `This receipt is already saved` with `Open it`, and Cancel or Back deletes the copy.
- Given an unreadable receipt or a 20 s wait, then `Couldn't read this receipt. Nothing was saved.` with `Try again` and `Enter it by hand`.

## Implementation Notes

Built and unit-tested (mocked native): the Kotlin intake compiles (`compileNosmsDebugKotlin`) but has not run on a phone. **Not built:** the native PaddleOCR / ONNX engine and its model files (15.6 MB, not in the repo, S3 section 8); the adapter reports `OCR_UNAVAILABLE` until `WmbugoOcr` exists, so on a phone today Snap receipt ends at `Receipt reading isn't working on this phone` and `Enter it by hand`. Also not done: the Maestro airplane-mode run, the NFR-06 frame-rate and NFR-08 5 s benchmarks (need the engine and a release build), the in-app photo thumbnail in the review. Provenance (`photo_picker`, `camera`) is kept on the pending photo only; the attachment table has no column for it. The intake digest is of the processed JPEG, so it matches photos saved through this path, not 3.11 originals.

## Spec Change Log

## Review Triage Log
