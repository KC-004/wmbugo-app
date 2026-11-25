---
title: 'Snap a receipt to split an entry, and one way in for every receipt source'
type: 'feature'
created: '2026-11-24'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3d5b930'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A recorded supermarket payment cannot be split by its receipt, and each receipt source would need its own path.

**Approach:** `Snap receipt to split` on a confirmed expense's detail starts a scan in attach mode (header `Splitting ₹2,340 · HDFC debit · 6:12 pm`, no match prompt, footer `Attach and split`) that commits through `AttachReceipt`. All sources call `startReceiptScan({ origin, attachTo?, imageUri? })`; the deep link `wmbugo://receipt/scan?attachTo=<id>` maps to it.

## Boundaries & Constraints

**Always:** a receipt lower than the entry shows the Tip / adjustment line; a receipt higher than the entry disables `Attach and split` and offers `Attach photo only`; a removed entry shows `This entry was removed. Nothing was changed.` and writes nothing; the link opens inside the app, behind the lock.

**Never:** open anything outside the app's navigator, or add a second scan path.

</frozen-after-approval>

## Code Map

- `features/receipt/startReceiptScan.ts` -- origins, `startReceiptScan`, `scanLinkRequest`
- `features/receipt/ReceiptScanFlow.tsx` -- scan, read, review for every source
- `features/receipt/ReceiptReviewScreen.tsx`, `receiptApi.ts` -- attach mode, `entry()`, `photoOnly`
- `features/activity/ReceiptPhotos.tsx`, `TransactionDetailScreen.tsx` -- the button and its conditions
- `features/shell/RootNavigator.tsx`, `AndroidManifest.xml` -- routes, `ScanLinkHost`, the `wmbugo://receipt/scan` filter

## Tasks & Acceptance

**Execution:**
- [x] Single entry and link, flow component, attach mode, detail button, tests

**Acceptance Criteria:**
- Given each of the six origins, then it reaches the review (unit test).
- Given a receipt of ₹2,600 for an entry of ₹2,340, then the warning shows, `Attach and split` is disabled and `Attach photo only` works.

## Implementation Notes

The widget, notification action and shared-image callers belong to Epics 11 and 12; they only call `startReceiptScan` or open the link. The origin does not change the path after the screen opens, so the test proves each origin through the same flow. A link without `origin` counts as `widget`. The intent filter lets any app open the scan screen (never with data); it is behind the lock and takes `attachTo` only as an id the ledger checks. Not done: a phone check of the link, and the Switch Access run end to end.

## Spec Change Log

## Review Triage Log
