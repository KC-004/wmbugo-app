---
title: 'Story 1.14 - Home shell and Activity list of saved entries'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '91b7ff8'
---

## Intent

Implements the epic's Story 1.14 acceptance criteria (see epics.md).

## Implementation Notes

- Core `profile/period.ts`: `periodFor(localDate, payday rule)` for calendar month and pay cycle (1st, last day, last working day Mon to Fri, day N on the last day of shorter months), with a fast-check property test that every local date is in exactly one period, periods tile the calendar and period ends are followed by a new period. Also day headings (`Today · Sat 7 Nov`), spoken dates, period scope label, greeting.
- Core `ledger/readModels.ts`: Spent = confirmed expenses minus refunds by `local_date` in the period, floored at zero (removed entries excluded); `homeAccounts` (In accounts = included asset accounts with a balance, not-set count, Card dues kept separate); activity query and `groupByDay` (day Spent excludes transfers, income and removed entries).
- Core `profile/promptState.ts`: `MarkPromptSeen` use case; the Home tooltip's `SeenStore` is now backed by `prompt_state` (through the writer).
- Mobile: `HomeScreen` (greeting, date, summary card, accounts line that stacks at fontScale 1.3, `Set up an account...` with an Add action, `+N accounts not set`, one-time tip, skeleton then Reveal), `ActivityScreen` (SectionList, 40dp category icon chip, `Category · Account`, unsigned expenses, `+` income in semantic-income, no minus, headings for TalkBack, boat empty state with `Add an expense`). Both read through TanStack Query keyed `home` and `ledger`, so a save invalidates them via `TransactionsChanged`. `useOpenAdd` is shared by the ＋ button and the Activity empty state.

## Verified on the Redmi

- Home showed the greeting, date, Spent this period with the pay-cycle scope, In accounts and Card dues side by side and the one-time tip; after tapping Got it, opening Activity and saving a new expense with the Add sheet it appeared in Activity and Home without a restart.

## Not done / open

- Card dues shows only when a card with a known balance exists (a missing card is not a zero).
- Activity loads the newest 500 entries without paging; paging comes with filters and search.
- Greeting hour and today's date use the profile timezone via the device clock; the Home tooltip is a bubble under the line, not an arrow-anchored popover.
- Refund rows exist in the read model but nothing creates refunds yet.
