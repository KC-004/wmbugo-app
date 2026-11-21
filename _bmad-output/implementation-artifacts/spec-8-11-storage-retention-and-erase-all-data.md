---
title: 'Story 8.11: Storage, retention and erase all data'
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

**Problem:** The person cannot see what wmbugo stores, how long deleted things stay, or leave without a trace.

**Approach:** Settings › Data shows Storage and the retention rules (read only) and an `Erase all data` flow: scope screen, confirmation checkbox, destructive button, re-authentication. The erase is restartable and ends on Welcome with no data and no key.

## Boundaries & Constraints

**Always:** an `erase.marker` is written first and removed last; a start that finds it finishes the erase before anything else; backup and export files saved elsewhere are never touched.

**Never:** no erase without the tick; Cancel or Back at either step changes nothing.

</frozen-after-approval>

## Tasks & Acceptance

- [x] core `backup/erase.ts`: `eraseAllData`, `finishInterruptedErase`, `ERASE_SCOPE_LINES`; `retentionLine` (from the purge constants); `Notifier.cancelAll?`; the privacy notifier forwards it
- [x] mobile: `rnErase` (layout and file adapter), `deleteDatabaseKey`, `startApp` finishes an interrupted erase first, `EraseFlow`, Storage and retention rows, a `destructive` Button variant, `STATES.md` confirm tier
- [x] tests: core 7 (kill at every step, person-owned files untouched), mobile 9 flow, 2 Settings

## Implementation Notes

- **Order:** maintenance, marker, cancel notifications, close the database, remove database and companions, photos, staging, safety copies, journal, logs, crash records and the other private files, delete the Keystore key, remove the marker. Killed at each of the first 30 file operations, the next start completes it and nothing wmbugo owns is left; a kill before the marker leaves the data intact.
- **The next start** has no database and no key, so `startStorage` makes a fresh key and onboarding opens (Welcome); a new key is generated only then, as Story 1.6 requires.
- **Not verified on a device:** the file-system and Keystore inspection after an erase, `resetGenericPassword`, closing the live connection, and the restart.
- Checks: lint and typecheck clean, core 1,055 tests, mobile 2,488 tests, gate self-test 27/27.
