---
title: 'Story 8.1: Redacted logs, local crash records and the no-network guarantee'
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

**Problem:** The Logger redacts by a deny-list of key names, so a new field name can leak money; crashes leave no local record; nothing proves the app has no analytics or network SDK; permissions are undocumented and requested ad hoc.

**Approach:** Make redaction allowlist-based with free-text scrubbing, add redacted local crash records (max 20), rotate logs at 1 MiB, add a dependency denylist gate, a permission inventory with a single `requestPermission(kind)` helper, re-read notification permission on resume, and a proxy-audit runbook.

## Boundaries & Constraints

**Always:** Field values outside the allowlist become `[redacted]`; digit runs of 3+ become `[n]`, `x@y` becomes `[id]`, masked account numbers become `[acct]`; logs and crashes live only in app-private storage; nothing is sent anywhere.

**Never:** No `console.log`; no network or crash-reporting SDK; no permission requested during onboarding; no log or crash file in shared or external storage.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fixture log | amount, merchant, note, `HDFC ••4821`, `sara@okhdfc`, image path, SMS body in fields and in an error message | none of the values in the file | n/a |
| Allowed field | `durationMs: 42`, `code: 'X'` | kept | n/a |
| 21st crash | 20 records on disk | oldest dropped, 20 kept | write failure swallowed |
| Revoked notifications | app resumes | bills and budgets re-read permission | n/a |

</frozen-after-approval>

## Code Map

- `packages/core/src/shared/logger.ts` -- deny-list redactor, replaced by allowlist plus `scrubText`
- `packages/core/src/shared/fileLogSink.ts` -- rotation already exists; cap raised to 1 MiB in `startApp.ts`
- `packages/core/src/ports/filestore.ts` -- gains `list(dir)` for crash pruning
- `apps/mobile/src/adapters/startApp.ts` -- LOG_MAX_BYTES, logger construction, handler install
- `apps/mobile/src/adapters/notifier.ts`, `billsApi.ts`, `budgetsApi.ts` -- direct `requestPermission` calls
- `scripts/check-permissions.mjs`, `scripts/android-permission-allowlist.json`, `scripts/test-gates.mjs`, `.github/workflows/ci.yml`
- `apps/mobile/android/app/src/main/java/app/wmbugo/MainApplication.kt` -- native uncaught exception hook

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/shared/logger.ts` -- allowlist redaction and `scrubText` -- AC 1, 2
- [ ] `packages/core/src/shared/crashRecord.ts` -- build and write redacted crash records, keep 20 -- AC 3
- [ ] `FileStore.list` in port, `rnFileStore`, test fakes
- [ ] `apps/mobile/src/adapters/crashHandlers.ts` and `startApp.ts` -- JS global handler and unhandled rejection; 1 MiB log cap
- [ ] `MainApplication.kt` -- native uncaught handler writing a message-free record
- [ ] `scripts/check-dependency-denylist.mjs`, fixtures, `test-gates.mjs`, `ci.yml`, symbols artifacts -- AC 5
- [ ] `apps/mobile/src/shared/PERMISSIONS.md`, `permissions.ts` (`requestPermission(kind)`), CI test, permission spy test -- AC 6
- [ ] resume refresh of notification permission -- AC 7
- [ ] `scripts/privacy/proxy-audit/README.md` -- AC 8 (runbook only; not run on this PC)

**Acceptance Criteria:**
- Given the fixture entry, when the log is read back, then no sensitive value appears.
- Given 25 crashes, when written, then 20 newest remain.
- Given a denylisted SDK in the lockfile, when the gate runs, then it exits non-zero.

## Implementation Notes

- Redaction is now an allowlist in `packages/core/src/shared/logger.ts` (`scrubText` for free text). The audit trail kept the old deny-list shape in `auditRedact.ts`, because audit rows keep labels and kinds inside the encrypted database; only logs use the stricter allowlist.
- `crashRecord.ts` builds and writes records (kind, type, scrubbed message, code locations, versions); `FileStore` gained `read` and `list`. JS errors and unhandled rejections (Hermes tracker) are captured by `crashHandlers.ts`, installed from `index.js`; a native uncaught exception is captured by `NativeCrashRecorder.kt` (class name and frames only, no message). Kotlin compiles (`compileNosmsDebugKotlin`).
- Log cap is 1 MiB with one previous file (`LOG_MAX_BYTES`); the log and crash directories are under `PRIVATE_DIR`.
- `scripts/check-dependency-denylist.mjs` (pnpm lockfile plus Gradle release classpaths), 4 gate cases in `test-gates.mjs`, CI steps for the report, the gate and symbol artifacts (source maps, `mapping.txt`, native `.so`).
- `PERMISSIONS.md` with a CI-checked row per allowlisted permission; `requestPermission(kind)` is the only request path (static test plus onboarding spy); the app re-reads notification permission on resume.
- `scripts/privacy/proxy-audit/README.md` is the runbook; it has NOT been run (needs an emulator and a proxy).
- Known limits: a fatal JS error may end the process before the async crash write finishes; free text cannot have merchant names scrubbed (only digits, ids and masks), so callers must keep names out of messages; `POST_NOTIFICATIONS` is documented and allowlisted but not yet in the manifest because the notification adapter is not installed.
- Checks: lint clean, typecheck clean, core 890 tests, mobile 2,243 tests, gate self-test 27/27.
