---
title: 'Reconcile a receipt and allocate tax, fees and discounts in core'
type: 'feature'
created: '2026-11-22'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '17df46b10c29d111816e4e596f8363edecf68913'
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A read receipt must become exact per-category amounts that add up to what was paid, with unread parts shown as Not itemised.

**Approach:** `allocateReceipt(draft, itemCategories, mainCategory)` and `toSplits` in `core.ledger`, built on `reconcileReceiptTotal` and `notItemisedSplit`.

## Boundaries & Constraints

**Always:** exact integer minor units (BigInt in the proportion step); remainder to the largest item (first on a tie); Not itemised never takes tax, fees or discounts; no negative row.

**Never:** save anything in a mismatch; touch the database or UI.

</frozen-after-approval>

## Code Map

- `packages/core/src/ledger/allocateReceipt.ts` -- allocation and splits
- `packages/core/src/ledger/allocateReceipt.test.ts` -- examples and fast-check laws

## Tasks & Acceptance

**Execution:**
- [x] Allocation, toSplits, tests

**Acceptance Criteria:**
- Given S$42.00 and S$18.00 with a S$6.00 discount and total S$54.00, then Groceries S$37.80 and Household S$16.20.

## Implementation Notes

A missing total counts as what was read adding up. Zero-weight items share equally. toSplits returns nothing in a mismatch.

## Spec Change Log

## Review Triage Log

- high, patched: charges rounded down one by one could push a tiny item below zero and report a false mismatch on a receipt that adds up (now taken back from the largest items)
- medium, patched: category order in splits used object key order (now first-seen); fractional or negative amounts threw in BigInt (now a mismatch); an empty category id was kept; tests for all-zero items, the rounding case, ordering and bad input; the property test now asserts no mismatch
- low, deferred: mismatch has no reason code; itemCategories length is not checked; main category equal to Uncategorised gives two Uncategorised rows (one flagged); sums above 2^53 in Number
