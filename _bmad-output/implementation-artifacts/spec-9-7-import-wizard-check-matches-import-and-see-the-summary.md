# Story 9.7: Import wizard: check matches, import and see the summary

Status: review

## What was built
- Core: `planImportFile` (the same read, validate and plan the run uses, writes nothing) and `entriesToImport` (how many entries the choices will create). 3 new tests in `import.test.ts`.
- `features/import/ImportRun.tsx`: Check matches (a group per import class with its count and what happens by default; per-row and per-group choices `Check later` / `Import anyway` / `Skip`, `Leave out` for rows removed before), `Import N entries`, progress with Stop (`LongTaskLoader`), summary (added, left out, waiting for you, couldn't be read), `Review N to check`, `Carry on` for a stopped or failed import, `Save these rows as a CSV` for unreadable rows (file's own cells plus a Problem column, UTF-8 with BOM).
- `features/import/ImportFlow.tsx`: wizard then run; an interrupted (paused) import is offered first with `Carry on` / `Not now`.
- `importApi.ts` split into `WizardApi` and `RunApi`; the real one runs `runCsvImport`/`resumeCsvImport` with the device-key encrypted raw copy.
- `adapters/import/rnRawFileStore.ts`: `RawFileStore` over the native encrypted writer used for receipt photos, in `<private>/imports`; Erase everything removes that folder.
- `PauseInterruptedImports` runs once at app start (not on resume, which could pause a live import).
- Settings: `import` page title, `onReview` prop wired to the ReviewQueue route.
- Jest setup: file-system binding and keychain are stubbed globally (the real ones are ESM-only or native).

## Implementation Notes
- Retention uses the core default of 30 days until Story 9.8 adds the setting.
- `Save these rows as a CSV` is offered only in the run that planned the file; after a resume there is no plan in memory.
- Review of imported rows happens in the existing review queue (Story 9.5 cards).
- Tests: 11 run/flow tests, 3 raw file store tests; mobile 2,817 passing, core 1,222 passing; eslint and tsc clean.
