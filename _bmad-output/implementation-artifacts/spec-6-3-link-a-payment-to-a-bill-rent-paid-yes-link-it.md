---
title: 'Story 6.3: Link a payment to a bill: Rent paid? Yes, link it'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: 'f4c729a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** A bill only moves on when someone marks it paid by hand, even when the payment is already in Activity.

**Approach:** `findBillMatch` suggests the unpaid due date an entry looks like the payment of (same normalised payee, amount within 10% inclusive, within 7 days, nearest first). `LinkBillPayment` writes a `linked` payment row (refused when the entry or the date is already paid), `UnlinkBillPayment` undoes it, `DismissBillMatch` remembers `Not this one` (migration 0022, `recurring_match_dismissed`), and `ReleaseBillLinks` runs on `TransactionsChanged` to free a due date whose entry was deleted, rejected or excluded. UI: the shared `BillMatchPrompt` card on transaction detail, a `Link an entry` picker on the bill, and linked history with the actual amount.

## Decisions

- Refusals carry the date and bill name in the error code (`ALREADY_LINKED:<date>:<name>`, `OCCURRENCE_PAID:<date>:<name>`) so the toast can say which; `parseLinkRefusal` reads them.
- Restoring a deleted entry never relinks it: the row was deleted on release, and the prompt shows again.
- The picker lists confirmed unlinked expenses within 15 days; the matcher accepts confirmed and waiting entries.
- The prompt is only the card; transaction detail decides when to show it, so the capture sheet can reuse it in Epic 11.

## Verification

- `billLinks.test.ts` (matcher boundaries, normalisation, ranking, link once, refusals, unlink, release and restore, picker) and `bills.test.tsx` (prompt, dismiss, linked line and Unlink, refusal toasts, picker, linked history).
- Full core and mobile jest, tsc and eslint pass.
