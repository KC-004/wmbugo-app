---
title: 'The native receipt reading engine'
type: 'feature'
created: '2026-11-24'
status: 'done'
route: 'oneshot'
baseline_commit: '1127156'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Build the engine Story 10.6 left out: PaddleOCR PP-OCRv4 on ONNX Runtime, bundled in the APK, behind the `WmbugoOcr` native module the `OcrEngine` adapter already calls, so Snap receipt reads a receipt on the phone with no network.

</frozen-after-approval>

## Implementation Notes

See `docs/decisions/S3-ocr-engine.md` section 11. Dependency `com.microsoft.onnxruntime:onnxruntime-android:1.19.2` passes the permission allowlist and the dependency denylist; models come from `scripts/fetch-ocr-models.mjs` (pinned hashes, not in git). Verified on the JVM with the real models on the synthetic receipts (133 / 136 lines, 8 / 8 totals); the Kotlin compiles into the app and the APK carries the models and libraries. Not verified on a phone: speed, memory, the whole flow through the app. Note for release: the four ABIs each carry `libonnxruntime.so` (12 to 20 MB); an `abiFilters` choice belongs to the store build (Epic 14).
