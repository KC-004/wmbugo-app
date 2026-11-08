---
title: 'Story 2.9 - Archive, restore and delete accounts safely'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '383e120'
---

## Intent

Implements the epic's Story 2.9 acceptance criteria (see epics.md).

## Implementation Notes

- Core (`accountCommands.ts`): `ArchiveAccount` now also sets the Settings default account back to None when it was that account; `RestoreAccount` returns the account to its previous place among the active ones (its group follows its type) and renumbers densely, instead of the end of the list (the Story 1.12 test was updated); `DeleteAccount` removes an account with no posting at all (an opening balance counts), clears it as the default and leaves an audit row, otherwise returns `ACCOUNT_HAS_POSTINGS` and writes nothing; `NEEDS_REVIEW_COUNT_SQL`. `ACCOUNT_LIST_SQL` gains `posting_count`.
- History is untouched by archiving: its entries stay in Activity and every period total (test), and an archived account leaves pickers, both groups, In accounts and Card dues. The Add sheet's "remembered account for a category" already skips archived accounts (test added).
- Mobile: `Archive` is on the account's own page and opens a confirmation: `SBI still has ₹1,200. Archiving keeps its history but stops counting it in your totals.`, a card `You still owe ₹4,100 on HDFC Card. …`, below zero and in credit wordings, and a plain `Archive SBI?` at zero or with no balance. `Adjust balance first` opens the adjust panel; `Archive anyway` archives, goes back and shows `Archived SBI` with Undo. Entries waiting for review add `1 entry on this account is waiting for you.` and are left alone.
- An archived account's page is read-only (timeline, starting balance, `This account is archived. Its history is kept.`) with `Restore`.
- The accounts list ends with a collapsed `Archived (n)` row; opened, each account shows its final balance with `Open` and `Restore`.
- In a row's edit mode: `Delete account` for an account that never held anything, behind `Delete SBI? This can't be undone.`; otherwise the hint `Accounts with entries can't be deleted. Archive keeps their history.`
- The copy-catalogue test now allows a template to start with a placeholder (`{name} still has …`).

## Deviation

- The list-level Archive button (and its TalkBack action) from Story 1.12 was removed so no account can be archived without the warning; archiving is from the account page.
- Archived accounts are not tappable rows in the main list; they open from the Archived section.

## Not done / open

- TalkBack reading of the confirmation and the Archived section was not checked on a device.
- Epic 2 is complete in code; the retrospective is the next step.
