---
title: 'Review a read receipt and save it as one expense'
type: 'feature'
created: '2026-11-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '7ab8d7577efdc021411ee6aa7f64e7a91479d148'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A read receipt has no screen to check and correct it, and no way to become one saved expense with its items and photo.

**Approach:** Core `SaveReceipt` (one writer transaction through the shared capture pipeline, splits, `receipt_item`, photo) and the mobile review screen SCR-23 with a pure review model, opened from a sample draft in the debug build until Story 10.6.

## Boundaries & Constraints

**Always:** allocation reruns after each edit; Save is blocked for an unsure or missing total and for a mismatch, never for a date; nothing is written on discard; a retry reuses the submission id.

**Never:** another currency (the entry fails with CURRENCY_DIFFERS; the Story 3.10 path is deferred), edit an applied migration, or push.

</frozen-after-approval>

## Code Map

- `packages/core/src/capture/receipt/saveReceipt.ts` -- the use case
- `apps/mobile/drizzle/0030_receipt_item.sql`, `ledger.schema.ts` -- receipt_item; purge deletes its rows
- `apps/mobile/src/features/receipt/` -- model, api, screen, sample, tests
- `RootNavigator.tsx`, `SettingsScreen.tsx` -- debug-only route and row

## Tasks & Acceptance

**Execution:**
- [x] Migration, SaveReceipt, purge, model, api, screen, copy, route, tests

**Acceptance Criteria:**
- Given a reviewed receipt, when Save is pressed, then one confirmed expense with a split per category plus Not itemised, receipt items and the photo are written in one commit.

## Implementation Notes

Gaps against the story text: no photo thumbnail or full-screen viewer (the photo arrives in 10.6); the foreign currency path (Story 3.10) is deferred; the date is a text field in YYYY-MM-DD form, not a picker; `Items (N)` expands to a read-only list (10.5 adds per-item categories); the quick chips reuse the Add ranking. Not run on the phone yet.

## Spec Change Log

## Review Triage Log

- high, patched: deleting or merging a category left receipt lines pointing at it (delete now refuses while a line names the category, merge moves the lines); a retry of a Cash-creating save could add a second Cash account; an impossible typed date (2026-02-31) closed the sheet and failed later with a generic message
- medium, patched: malformed printed time, case of the currency code, one category per item checked, amount editor refused zero for charges, double tap on Save, load failure left a blank screen, Android back skipped the discard question, invalidate failure after a save, tests for duplicate, currency, date, merchant, charge and load paths
- low, deferred: item name, amount and category are not editable yet (10.5); the merchant edit does not re-derive shop defaults; photo thumbnail and viewer arrive with 10.6; foreign currency path (Story 3.10) not built; the debug route is not covered by a test; dates show as YYYY-MM-DD
