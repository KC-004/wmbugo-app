# Story 9.9: Export transactions and account summaries as CSV

Status: review

## What was built
- Core `export/csvExport.ts`: `exportTransactionsCsv` and `exportAccountsCsv` write to a sink in pages of 500 entries (progress and cancel between pages), `resolveExportPeriod` (This period, Last period, This year, All time, Custom range), `exportFileName`, `maskedNumber`, `defaultPeriodChoice`.
- Transactions file: UTF-8 with BOM, comma, CRLF; the six `#` metadata lines (period, filters, timezone, currency, schema `wmbugo-transactions-1`, confirmed entries only); header `date,time,merchant,category,account,account_number,type,amount,currency,reference,note,source,entry_id`; one row per split part with the same `entry_id`; one row per transfer leg (`transfer_out` / `transfer_in`, filtered to the chosen accounts); unsigned amounts with `type` carrying direction. Cells go through the Story 7.3 writer, so a cell starting `=`, `+`, `-`, `@`, tab or CR is prefixed with `'`.
- Account summary: `wmbugo-accounts-1` with `account,type,status,account_number,start_balance,money_in,money_out,end_balance,balance_side,currency`, balances from the same postings as the Accounts screen, `have` / `owe`, and an account with no balance set has empty balance cells and `not set`.
- Settings › Data › `Export CSV`: What to export, Period (defaults All time for transactions, This period for the account summary), Accounts (all or chosen), the account-numbers switch (off), `Export`; a confirm sheet (`This file won't be encrypted...`), the shared re-authentication guard, the CSV save dialog (native `createCsvDocument`, `text/csv`), the coin-flip loader (`Exporting…`, `4,000 of 10,000 entries`, `Cancel` deletes the partial document), toasts (`Exported 1,284 entries` / `Exported 6 accounts`) and `Couldn't save the file. Nothing on this phone changed.` with `Try again`.
- The Money page's currency explanation gains `Export your entries`, which opens Export CSV on Transactions and All time.
- `PERMISSIONS.md` and `STATES.md` updated (exported files are unencrypted; export is in the confirm tier with re-auth).
- Import side: the "rows not imported" file now uses the CSV dialog and core `utf8Encode` (Hermes has no `TextEncoder`).

## Implementation Notes
- Known gap: wmbugo stores no account numbers, so the `account_number` column is empty even with the switch on; the core already masks digits when it is given any (`ExportOptions.numbers`).
- `start_balance` and `end_balance` are unsigned with one `balance_side` (the end balance's); a start balance of the opposite side is not marked.
- Entries reversed (status `reversed`) and their reversal entries are both left out, so a reversed entry nets to nothing in the file.
- Tests: core +12, mobile +14; core 1,244 and mobile 2,923 passing; eslint and tsc clean.
