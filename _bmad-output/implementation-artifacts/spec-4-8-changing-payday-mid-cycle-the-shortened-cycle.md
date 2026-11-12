---
title: 'Story 4.8 - Changing payday mid-cycle: the shortened cycle'
type: 'feature'
created: '2026-11-13'
status: 'done'
route: 'oneshot'
baseline_commit: '8cad6dd'
story_key: '4-8-changing-payday-mid-cycle-the-shortened-cycle'
---

## Intent

Implements the epic's Story 4.8 acceptance criteria (see epics.md): BDG-002 (payday change, shortened cycle), ONB-006 (period change re-aggregation), AD-7. No migration (the history lives in the settings table).

## Implementation Notes

- `PaydayRule` now carries optional `transitions`: each `{start, end, previous rule, normalDays}`. Dates before `start` follow the earlier rule, `start` to `end` is one shortened cycle (empty when the new payday falls on a boundary), later dates follow the new rule. `periodFor` follows them, so every date is in exactly one period and past periods never move. A `Period` can be `shortened` with the `normalDays` it was cut from.
- `planPaydayChange(today, current, next)`: the cycle ends the day before the new payday when that is inside it (a payday that is today ends it yesterday); when the new payday is after the cycle's normal end the cycle ends as planned and the days up to it are one shortened cycle. `nextPaydayOnOrAfter`, `prorateTarget` (target × days ÷ normal days, rounded half up), `periodTitle` (`1–24 Nov · Shortened cycle`).
- `profile/paydayChange.ts`: the stored history (`finance.payday_transitions`), `readPaydayRule` (the one way every reader gets the rule with its history), `previewPaydayChange` (read only, for the confirmation). `ChangeProfile` records the transition when payday changes to another pay cycle and rebuilds the budget periods in the same transaction; no transaction, split or posting changes.
- Budgets: `periodTarget` pro-rates a shortened cycle for budgets on the default period (overall, Need/Want and default-period category budgets); weekly, monthly and custom budgets keep their periods. `budget_period` rows carry `shortened = 1` and the pro-rated target; the cache now also holds the next period (`25 Nov–24 Dec` at the full target). SCR-14, SCR-15 and the Home period label read `1–24 Nov · Shortened cycle`; the app's `readProfile` passes the history to every screen.
- Settings: choosing another payday first shows `Your current cycle will end on 24 Nov. Budgets for 1–24 Nov are adjusted to match.` with `Change payday` / `Cancel` (Cancel changes nothing; Not salaried and a change with nothing cut short save at once).
- Tests: the spec scenarios (1st to 25th on 10 Nov, payday today, 1st to the 5th on 28 Nov, pro-rating of each budget kind, unchanged ledger, past periods unchanged, repeated changes), a property test that every date is in exactly one period with no gaps or overlaps and a shortened cycle never longer than the normal one, and the app-side read.

## Deviation

- Changing payday to `Not salaried` records no transition (periods become calendar months, as before).
- The cache holds the next period for every budget, not only after a payday change.
- Not checked on a device with TalkBack.
