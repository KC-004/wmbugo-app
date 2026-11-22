---
title: 'Spike S3: OCR engine choice and the synthetic receipt set'
type: 'chore'
created: '2026-11-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '838c7c6be85f044094b30aa01f7ce869c89d91b4'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Receipt scanning needs an engine proven to read offline in a build without `INTERNET`, passing the Story 8.1 denylist and allowlist, and a reference set to test parsing against.

**Approach:** Compare ML Kit 16.0.1 (bundled) and PaddleOCR on ONNX Runtime on the connected reference phone and the release manifest and dependency checks; record a decision in `docs/decisions/S3-ocr-engine.md`; merge only the `OcrEngine` port, the 40 synthetic receipts with ground truth and the recorded `OcrResult` fixtures.

## Boundaries & Constraints

**Always:** no real receipts in the repo; spike code is not merged; an engine that fails the denylist or allowlist is rejected; every measurement gap is written down.

**Never:** amend the denylist, add `INTERNET`, or sign GATE-05 on the owner's behalf.

</frozen-after-approval>

## Code Map

- `packages/core/src/ports/OcrEngine.ts` -- the port, `OcrResult`, `OCR_UNAVAILABLE`, `CANCELLED`, `isOcrFailure`
- `fixtures/receipts/synthetic/` and `scripts/gen-synthetic-receipts.mjs` -- 40 images, ground truth, seeded generator
- `packages/core/test/fixtures/receipts/*.ocr.json` -- recorded PaddleOCR results
- `packages/core/test/receiptFixtures.test.ts` -- set mix, sums, privacy and fixture shape tests
- `docs/decisions/S3-ocr-engine.md` -- the decision record

## Tasks & Acceptance

**Execution:**
- [x] Build the 40-receipt synthetic set and ground truth
- [x] Run both candidates on the phone; check release manifest and denylist
- [x] Define the `OcrEngine` port; save the 40 recorded results
- [x] Write the decision record

**Acceptance Criteria:**
- Given the record, then it names PaddleOCR with ML Kit evidence and every gap listed.
- Given the repo, then no spike code, model file or `INTERNET` change is merged.

## Implementation Notes

Spike code, models and scorer were kept outside the repo (session scratch) and removed from the tree. ML Kit failed the denylist and crashed when its Firebase or datatransport classes were excluded. GATE-05 is interim and unsigned, like GATE-03.

## Spec Change Log

## Review Triage Log

- medium, patched: recorded fixtures only shape-checked (now check the total digits appear and scan recorded text for private patterns)
- low, patched: doc counts of multi-column (6) and low-contrast or tilted (9) corrected; dead ternary removed; font load now throws if missing; port contract documents empty blocks and already-aborted signal
- low, deferred: canvas size for tilted long receipts, date range stops at November and day 27, item names stay Latin on Devanagari and Arabic receipts, scorer not committed
- low, rejected: ML Kit allowlist not re-run (record already says so; rejection rests on the denylist)

