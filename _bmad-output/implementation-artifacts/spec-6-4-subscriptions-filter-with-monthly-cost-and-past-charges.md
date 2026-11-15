---
title: 'Story 6.4: Subscriptions filter with monthly cost and past charges'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: 'ec27ff5'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** A user cannot see what their subscriptions cost per month or what they have really been charged.

**Approach:** Exact monthly-equivalent maths in core (`monthlyEquivalent` as a BigInt fraction, summed exactly and rounded half-up once), a per-row `monthlyEquivalentMinor` and a list `subscriptions` total (active only). SCR-16 gains `All bills` and `Subscriptions` chips; Subscriptions shows the header card, the conversion caption and per-row cost phrases. A subscription's detail lists Past charges (linked entries as Activity rows, marked ones as a line). No migration.

## Decisions

- Paused and ended subscriptions are listed but not counted (`Not counted while paused`, `Not counted · ended`).
- A monthly subscription shows no extra phrase (its amount is already the monthly cost).
- Copy keys are whole templates (`{amount} a year · about {monthly} a month`) to satisfy the sentence-case catalogue test.

## Verification

- `subscriptions.test.ts` (conversions, half-up, exact sum vs rounding each part, list total with paused and ended) and the Subscriptions block in `bills.test.tsx` (filter, header, caption, empty state with Subscription preselected, masking and the spoken label, Past charges).
