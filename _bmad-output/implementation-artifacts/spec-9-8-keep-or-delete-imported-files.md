# Story 9.8: Keep or delete imported files

Status: review

## What was built
- Setting `import.raw_retention` (`delete_after` | `days_30` | `keep`, default 30 days), profile-owned, changed only through `SetImportRetention` (the generic `ChangeSetting` path refuses it): it recomputes `retain_until` of every finished import from its `completed_at` and returns the copies whose time has already passed, which the caller deletes after the commit.
- `Deleted after import`: `retainDays: 0` makes the run call `DropImportRawCopy` after the completing commit; a paused import keeps its copy (Resume needs it).
- `PurgeExpired` and the daily purge now also clear `raw_path` of finished imports past `retain_until` and return `importFiles`; `import_batch` rows and every source fingerprint stay, so re-imports stay idempotent. Clock tests at 29 and 31 days.
- `DeleteImportFile` (`Delete file now`), `DiscardImport` (a paused import is abandoned and its copy released), `listImports`.
- Migration 0029 adds `import_batch.file_name`; the native picker returns the display name (`openRead` gains `name`), cleaned by `cleanFileName` (no folders or control characters, 120 characters).
- The entry detail's Source line reads `CSV import · statement-nov.csv · row 57` (source records join their import batch).
- Settings › Data › `Imported files` row (summary `Kept 30 days` / `Deleted after import` / `Kept until you delete them`) and page: three radio choices, the line `Copies stay encrypted on this phone. Nothing is uploaded.`, the imports list with `Delete file now` (confirm sheet) and `Discard` for unfinished ones. The interrupted-import card gains `Discard`.
- Orphan sweep at app start deletes any copy in `<private>/imports` that no `import_batch` row points at.

## Implementation Notes
- The no-network check is the existing Story 8.1 gate (no `INTERNET` permission); nothing here adds a request.
- Counts in the list use plain digit grouping, because feature code may not use `Intl.NumberFormat` for numbers.
- Tests: core +11 (retention, purge at 29/31 days, delete, discard, list, file name), mobile +21; core 1,232 and mobile 2,858 passing; eslint and tsc clean.
