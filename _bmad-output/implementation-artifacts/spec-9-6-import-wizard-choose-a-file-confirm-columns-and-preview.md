# Story 9.6: Import wizard: choose a file, confirm columns and preview

Status: review

## What was built
- Settings > Data > `Import CSV` row (`From a file your bank or card gives you`) opening an in-place `import` page (same pattern as Backup and Restore).
- `features/import/ImportWizard.tsx`: Step 1 Choose a file, Step 2 Check the columns, Step 3 Preview. A file whose headings match a saved layout skips Step 2 (`Step 2 of 2`).
- `importModel.ts` (pure helpers over the core reader: `readWith`, `columnNames`, `check`, `columnsBlock`, `accountReady`, `needsReread`), `importApi.ts` (the only IO: picker, profile and accounts, saved layouts).
- `StepperHeader` (shared/ui) and `LongTaskLoader` (shared/brand, coin flip, polite live region).
- Native picker `pickCsvDocument` (CSV and text first, browse-all still possible) and `pickCsvFile` adapter (reads in 256 KiB pieces, refuses over 20 MiB without reading).
- Column picker sheet per role, File settings sheet (encoding, separator, headings row), day/month order question, account chooser or per-value account mapper (with `Don't import these rows`), `Flip sign` for `SIGN_LOOKS_REVERSED`, remember-layout checkbox, `Check matches`.

## Implementation Notes
- Nothing is written until `Check matches`; the only write is the optional layout save, and a failed save never stops the import.
- `onContinue(draft)` hands bytes, read result, mapping, account choice and validation to Story 9.7. Settings passes a temporary handler that returns to Data until 9.7 lands.
- The picker does not return a file name, so the file summary line uses the count only.
- Back from a saved-layout preview returns to Step 1 and drops the saved layout (back to three steps).
- Tests: 19 wizard tests, 3 picker adapter tests; mobile suite 2,747 passing; eslint and tsc clean.
