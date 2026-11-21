---
title: 'Story 8.10: Diagnostics with a preview before anything is exported'
type: feature
created: '2026-11-21'
status: in-review
route: dispatch
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There is no way to see wmbugo's technical status or to get help without handing over finances.

**Approach:** Settings › Help › Diagnostics shows the status list; `Export diagnostics` previews the exact text (status, last 500 redacted log lines, redacted crash records), needs a consent tick, and saves through Android's save dialog.

## Boundaries & Constraints

**Always:** the saved bytes equal the previewed text; every log line and crash record is redacted again at export; values that cannot be read say `Not available`.

**Never:** nothing leaves the phone from the status screen; no export without the tick.

</frozen-after-approval>

## Tasks & Acceptance

- [x] core `shared/diagnostics.ts`: `DiagnosticsStatus`, `statusLines`, `buildDiagnosticsText`, `redactLogLine`, `crashLine`, file name; the 8.1 fixture moved to `testing/redactionFixture.ts` and run against the export
- [x] mobile: `adapters/diagnostics.ts` (each probe on its own), `getAppInfo` in `PrivacyModule`, `DiagnosticsScreen` and `DiagnosticsExportScreen`, `CheckRow` shared with Restore, parser and section registry (`Check a parser` absent until one registers; slot for Epic 13's `Background capture`)
- [x] Settings gains a `Help` group (Diagnostics) with the two pages
- [x] tests: core 20, mobile 11 plus Settings

## Implementation Notes

- The log is re-redacted at export (time and level kept, fields through the allowlist), so a file from an older build cannot carry a forbidden field. A line that is not the expected JSON is scrubbed as text.
- App lock shows from the in-memory flag, so it is known even when the database cannot be read; schema, last backup and safe mode are `Not available` then.
- Not verified on a device: the real storage and permission readings, the flavor from the package id, and the save dialog with `wmbugo-diagnostics-2026-11-08.txt`.
- Checks: lint and typecheck clean, Kotlin compiles.
