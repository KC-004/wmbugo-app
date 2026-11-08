---
title: 'Story 2.2 - Accounts list with Money you have and Money you owe'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '7561462'
---

## Intent

Implements the epic's Story 2.2 acceptance criteria (see epics.md).

## Implementation Notes

- Core `ledger/balances.ts`: `accountLine` (one account as `have`, `below-zero`, `owe`, `in-credit` or `not-set`, always unsigned) and `accountGroups` (the two groups in saved order, each with a total, a not-set count and an excluded count, plus net worth). Totals come from `overviewTotals`, the same query Home reads, so the list and Home cannot disagree. The two totals are never added together; only the optional net worth row meets them.
- `SetAccountInclusion` use case: saves `include_in_overview` (this is the story's `include_in_totals`, see Story 2.1) with audit and `AccountsChanged`; a card refuses (`CARD_ALWAYS_COUNTS`).
- `MoveAccount` now moves within the account's own group (a card among cards, anything else among the rest), so Move up and Move down always change something the user can see.
- New setting `ui.show_net_worth` (boolean, off by default, validated like the other switches); `AppSettings.showNetWorth`.
- Mobile `AccountsScreen`: group headers read as headings with their total (`Money you have, 52,300 rupees, 1 account not set`), rows read name, type, amount with direction; rows show `You owe`, `Below zero` or `In credit` in words beside an unsigned amount; `Not counted in totals` label on a left-out account and `Excludes 1 account` under the group; `Count in my totals` switch in the row's edit mode (not shown on cards); `Show net worth` switch at the foot with the `Net worth` row and its caption, or `Net worth: you owe X more than you have`.
- A group with only not-set accounts reads `Not set yet`, never zero; with some known, the total reads `₹52,300 · +1 account not set`.

## Deviation

- The edit screen the AC names is the row's inline edit mode, where Rename already lives; the account detail screen arrives in Story 2.3 and can host the same switch.
- The fontScale 1.3 stacking at 320dp was not measured on a device. Amounts sit in a wrapping row so they wrap under the name instead of truncating.

## Not done / open

- Device check of TalkBack reading is left to the user.
