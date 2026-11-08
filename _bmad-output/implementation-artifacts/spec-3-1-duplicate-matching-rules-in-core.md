---
title: 'Story 3.1 - Duplicate matching rules in core'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '1e40370'
---

## Intent

Implements the epic's Story 3.1 acceptance criteria (see epics.md) and PRD FIN-027. Pure TypeScript in `packages/core/src/capture`, no storage, no clock, no RN imports.

## Implementation Notes

- `capture/merchant.ts`: `normalizeMerchant` (LRN-009): lowercase, trim, keep the part before a `*` (or after a gateway prefix such as `paytm*`), drop leading rail words (`upi-`, `pos `, ...), drop trailing reference numbers, city codes (`blr`, `mum` ...) and filler (`order`, `txn` ...). `SWIGGY*BLR 8821`, `Swiggy` and `SWIGGY  ORDER 4410` all give `swiggy`; a name is never reduced to nothing.
- `capture/match.ts`: `matchItem(item, existing, ctx)` returns the typed `MatchOutcome`: `no_match`, `duplicate_of`, `possible_duplicate_of`, `reversal_or_refund_of`, `transfer_pair_with`, `held_pair(id, question)` and `previously_removed`. Rules follow FIN-027: same reference, direction and event type is a duplicate; two different references are never a duplicate or possible duplicate; same reference in the opposite direction is a reversal (same account or text says reversed, refund or failed), a transfer pair (another owned account) or a held pair (`Reversal, or a transfer between your accounts?`); with at least one reference missing, equal amount, dates within one day and equal normalized merchant is a possible duplicate; a receipt also matches a card or bank charge 0 to 30% higher (1,000 vs 1,150 yes, vs 1,301 no); no merchant never fuzzy-matches; two manual entries only within 10 minutes; transfer pairs across two owned accounts within 3 days (captures) or 2 days (CSV) even with different references.
- CSV: rows of one file never match each other or rows committed from that file (`fileId`); `assignOccurrenceIndex` numbers identical (date, amount, description) rows so the Nth identical row is distinct; rows on a partly covered first or last day come back as `held_pair` (id of the same-day candidate, or null) instead of being skipped or added.
- When several items match, the strongest outcome wins and ties go to the smallest id, so the result never depends on the order of `existing`.
- Tombstones (`ctx.tombstones`) give `previously_removed` by reference, or by amount, date and merchant when there is no reference (the store arrives in Story 3.12).
- Tests: the AC examples as fixtures, plus fast-check properties (deterministic and order-independent, duplicates symmetric, differing references never match, same-file CSV rows never match).

## Deviation

- The AC names PRD section 8.3 and 8.8 worked examples as fixtures; in this PRD those sections are Transaction CRUD and Home, not dedup. The fixtures come from the Story 3.1 AC and FIN-027 text instead.
- `held_pair` carries `id: string | null` (null for a partial-day CSV row with no candidate).

## Not done / open

- Nothing consumes the matcher yet; Story 3.2 wires it into the capture pipeline. No device check (pure logic).
