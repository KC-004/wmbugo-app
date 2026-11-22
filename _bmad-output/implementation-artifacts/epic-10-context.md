# Epic 10 Context: Receipt scanning

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Mei snaps or picks a receipt and wmbugo reads merchant, date, total and line items on the phone, offline from install, with no download and no network. She sees a `Reading receipt…` loader with a scan line and an item count she can cancel, then a short review screen (category totals first, `Items (N)` collapsed, a grey `Not itemised` row, an editable `Paid with` chip, a total she must confirm when the read is uncertain). A receipt that probably matches an existing entry offers `Attach to it`, `Keep separate` or `Discard`; it never creates a second confirmed expense on its own. When parsing fails she is one tap from manual entry with the photo kept. Epic 11 (widget, notification action) and Epic 12 (shared images) call the single receipt-scan entry this epic exposes.

## Stories

- Story 10.1: Spike S3, OCR engine choice and the synthetic receipt set
- Story 10.2: Read receipt lines and fields in core
- Story 10.3: Reconcile a receipt and allocate tax, fees and discounts in core
- Story 10.4: Review a read receipt and save it as one expense
- Story 10.5: Give each receipt item its own category
- Story 10.6: Pick a receipt photo and watch it being read
- Story 10.7: Snap a receipt with the camera
- Story 10.8: A receipt that matches an entry: Attach to it, Keep separate or Discard
- Story 10.9: Snap a receipt to split an entry, and one way in for every receipt source

## Requirements & Constraints

- The engine reads in airplane mode from install in a release build with no `INTERNET` permission, no model download and no telemetry or transport library; the Story 8.1 dependency denylist and permission allowlist must still pass. An engine that cannot pass both is rejected (fallback: attach the photo and enter by hand).
- Real receipts never enter the repo or CI; only synthetic or re-typeset receipts with ground truth. No real names, card fragments, phone numbers or loyalty IDs.
- Target: 90% or better correct total, merchant and date overall (NFR-17). Western numerals on Arabic and Devanagari receipts must be read.
- Money is exact minor units end to end (Story 1.4 primitives); amounts never floats. Decimal-comma, decimal-point and Indian grouping are read by region.
- Receipts submit through the existing `SubmitCapture` pipeline and FIN-027 matcher unchanged; every field of a read receipt is correctable; saved entries are confirmed only on Save.

## Technical Decisions

- The `OcrEngine` port returns positioned text blocks and lives in `packages/core/src/ports/OcrEngine.ts`; all parsing, reconciliation and allocation live in core (pure TypeScript, no React Native imports). Engine specifics stay in the mobile adapter.
- New in this epic: `receipt_item` table (owner: ledger), the `AttachReceipt` use case, the OCR scan-line variant of the Story 9.6 `<LongTaskLoader>`. Never edit an applied migration.
- Decisions are recorded under `docs/decisions/` (S3 follows S1, S2 and S8). Existing receipt photo storage is the Story 3.11 `ReceiptFilesModule` and filestore port.

## UX & Interaction Patterns

- Review screen order: category totals, `Items (N)` collapsed, `Not itemised` row, `Paid with` chip, total confirmation when uncertain. Entry points: Add flow `Snap receipt` chip, long-press on the plus button, gallery pick; camera permission is asked just in time with `Pick a photo instead` as the alternative.

## Cross-Story Dependencies

- 10.1 picks the engine and supplies the `OcrResult` fixtures that 10.2 and 10.3 test against. 10.2 and 10.3 feed 10.4 (review and save), which 10.5 extends with per-item categories. 10.6 and 10.7 produce the image and run the engine; 10.8 adds matching; 10.9 adds the shared single entry used by Epics 11 and 12.
