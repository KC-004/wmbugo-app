---
title: 'Story 1.12 - First account and the accounts list'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '1f0479f'
---

## Intent

Implements the epic's Story 1.12 acceptance criteria (see epics.md).

## Implementation Notes

- Migration 0004 (`account`, `transaction`, `posting`) from `ledger.schema.ts`, with CHECK constraints (types, status, the seven event types, non-negative amounts, date shape, posting direction agreeing with its sign) and foreign keys. `transaction` is created complete (S2 section 4.2). `PRAGMA foreign_keys = ON` is set on every connection (the adapter now does this; it was off before).
- Core `ledger` module: type defaults (icon and cat colour), name validation, opening sign rule (a card's owed amount is stored negative), presenters (`balanceOf` returns not-set, never zero; `cardDues`; `assetTotal` excludes cards, archived and not-set accounts), `buildNewAccount`, and the use cases AddAccount, RenameAccount, MoveAccount, ArchiveAccount, RestoreAccount plus the `openingBalanceShape` invariant. New catalogue event `AccountsChanged`.
- `SetUpProfile` moved to the use-case layer (it now writes profile + account + opening transaction + posting in one transaction, and a bad account name fails the whole setup).
- Onboarding: new SCR-03 step between region and payday with the shared `AccountForm` (types, name, "Rough is fine" balance, Skip, inline `Error: name required` with focus to the field).
- Accounts screen (Accounts icon in any header): list with ledger-derived balance or "Balance not set", add, rename, Move up / Move down (buttons and TalkBack custom actions), archive with a toast Undo. Archived accounts are hidden but keep history.
- Tests use a real SQL engine: `node:sqlite` behind the SqlDatabase port, loaded with the app's real drizzle migrations (`packages/core/src/testing/nodeSqlite.ts`, test-only).

## Verified on the Redmi

- Migration 4 applied on the existing database with a 61 KB safety copy. By hand: added accounts including a credit card (shows owed, no minus), reordering, rename, archive and Undo all worked; the screenshot shows the card owing 250.00.

## Not done / open

- The opening balance on `account.opening_minor` duplicates the opening posting (the posting is the source of truth); GATE-07 should decide whether to drop the column (noted in S2).
- A zero opening balance stores a known zero with no posting.
- Names are not unique (two accounts may share a name).
- The account form does not yet offer credit limit or statement fields (columns exist, UI arrives with the cards story).

## Review Triage Log

Inline self-review plus real-SQL tests plus device. Fixed: (1) high - foreign keys were never enabled on the app's connection (SQLite default is off), so the schema's references would not have been enforced; now set on open and tested. (2) medium - the Move use case renumbered in two passes for no reason; simplified. (3) low - "owed" copy failed the sentence-case rule; the spoken label lowercases it.
