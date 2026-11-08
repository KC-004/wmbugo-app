---
title: 'Story 3.6 - Search, filters and sort in Activity'
type: 'feature'
created: '2026-11-09'
status: 'done'
route: 'oneshot'
baseline_commit: '4bf8aa1'
---

## Intent

Implements the epic's Story 3.6 acceptance criteria (see epics.md) and PRD TXN-007.

## Implementation Notes

- Index: migration `0008_activity_search` (a drizzle custom migration, since drizzle does not model virtual tables) creates an FTS5 table `activity_search` over merchant, original description, note, category names and account names, and backfills existing entries. `apps/mobile/package.json` now sets op-sqlite `"fts5": true`; the migration ran on the device (the FTS5 module is in the SQLCipher build).
- Kept current inside the writer transaction: `LedgerWriter` takes an `indexer` that runs after the use case and the invariants with everything it touched (`searchIndexer` re-indexes touched transactions, and the transactions of a touched account, because the account name is searched). A change and its index entry commit or roll back together (tests: create, edit, rename, rolled-back write).
- Core `ledger/activitySearch.ts`: `activityQuery(query, limit)` builds the page query for search text (every word, the last as a prefix), account, category, type, status (Waiting for you, Possible duplicate, Needs a category, Guessed, Reversed), date range, amount range, Show rejected (rejected captures of the last 90 days, counted nowhere) and four sorts; `activityCountQuery` gives the `Show N results` number. A plain number such as `450` also matches entries of exactly that amount. With a category filter a day's Spent counts only the matching split amounts (`matchedMinor`). Sorted by amount or merchant the list is flat (no day headers, no Spent).
- Performance: with 10,000 seeded entries 20 searches stay far below the 500 ms target (p95 asserted `< 500` in the core test; the figure on the reference device was not measured).
- Mobile Activity: Search replaces the title with a field (`Search merchant, note, category or amount`) and `Clear`, results follow typing after 300 ms, Back closes and clears; a 48dp chip row `Filters · N` with one removable chip per active filter (`Remove filter: HDFC`), `Clear all` from two filters, and the TalkBack announcement `Filter removed. 42 results`; the filter sheet (Date presets and custom range, Accounts with archived apart, Categories, Type, Status, Amount from/to, `Show rejected` with its caption, Sort, `Reset` and `Show N results`); `No matches · Clear all`.
- Filter state lives in transient UI state (`useUiStore.activityFilter`): kept across tab switches, gone after process death. Home reads its own queries, so its totals are unaffected by any filter.

## Deviation

- The 10,000-entry search timing was asserted in core tests (real SQLite), not measured on the reference phone.
- The filter sheet's amount fields assume the profile currency's two decimals when pre-filling and counting; the search query itself uses the profile exponent.
- Back or swipe closes the sheet through the sheet host without a separate confirm; applying is only through `Show N results`.

## Not done / open

- Search p95 on the reference device with 10,000 entries (NFR-07).
