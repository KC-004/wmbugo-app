---
title: 'Story 1.2 — Spike S1: Encrypted storage and migration toolchain'
type: 'chore'
created: '2026-11-08'
status: 'done'
baseline_commit: '4166b03e1653b6d9f1675367704f41239d257177'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.6 (encrypted DB) and 1.5 (schema) assume op-sqlite + SQLCipher, Drizzle `.sql` migrations and a `packages/core` import all work under pnpm hoisted + Metro + a release build. None of it is proven, and AD-2 may need a fallback.

**Approach:** Run a throwaway probe in `apps/mobile` that exercises each question on an emulator in a release build. Write `docs/decisions/S1-storage-migrations.md` with the verified answer or chosen fallback per question. Keep only configuration the record marks confirmed; remove the probe code.

## Boundaries & Constraints

**Always:**
- op-sqlite 19.x; drizzle-orm and drizzle-kit 0.45.x (not 1.0 RC); drizzle-kit `driver: 'expo'`.
- Verify in **release** builds (nosms flavor) on an emulator; debug bundling is checked as well for the core import.
- Record the exact SQLCipher flag location, the exact Metro/Babel config, and the core-import result (or AD-2 fallback plus the change it forces to Story 1.1's layout).
- Any unanswered question gets its blocker, chosen fallback and affected stories (1.6 at minimum) in the record.
- Spike harness code lives under `apps/mobile/src/spike/` in its own commit, then is removed in a later commit; the record cites the probe commit hash.

**Never:**
- No production adapter, schema, KeyStore or UI (Stories 1.5/1.6). The probe key is a fixed throwaway string, never real.
- No `INTERNET`/non-allowlisted permission added; `pnpm check:permissions`, lint and typecheck stay green.
- No `console.log` in `src` (report results on screen and via an allowed channel).
- Do not edit planning artifacts or Story 1.1 files beyond confirmed config.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| SQLCipher present | Release build, flag set | `PRAGMA cipher_version` non-empty | Empty → record names flag-location failure and fallback |
| Migration | Sample `.sql` through Metro/Babel, release | Applies in one transaction; Drizzle insert/select round-trips | Failure → record the blocker |
| Core import | `apps/mobile` imports a core symbol | Bundles in debug and release | Fails → record AD-2 fallback and Story 1.1 layout change |
| Encrypted at rest | DB file pulled off emulator | Header is not `SQLite format 3` | Plain header → SQLCipher not active |

</frozen-after-approval>

## Code Map

- `apps/mobile/package.json` -- add op-sqlite, drizzle-orm; the SQLCipher flag goes in the `op-sqlite` key here (AD-8); drizzle-kit as a dev dependency.
- `apps/mobile/metro.config.js`, `babel.config.js` -- add `.sql` to `sourceExts` and the Drizzle inline-import Babel plugin; both already hoisted-aware.
- `apps/mobile/drizzle.config.ts` -- `driver: 'expo'`, sample schema, output `drizzle/`.
- `apps/mobile/App.tsx`, `src/spike/**` -- throwaway probe screen; remove after verification.
- `packages/core/src/index.ts` -- existing symbol imported by the probe.
- `apps/mobile/android/app/build.gradle` -- hoisted paths already set; check autolinking of op-sqlite.
- `docs/decisions/S1-storage-migrations.md` -- new decision record (the `docs/` dir does not exist yet).
- Reuse `pnpm check:permissions`, `lint`, `typecheck`; emulators `Medium_Phone` and `Pixel_10` exist; no device is running.

## Tasks & Acceptance

**Execution:**
- [x] `apps/mobile/package.json` -- install op-sqlite 19.x, drizzle-orm 0.45.x, drizzle-kit 0.45.x; set the SQLCipher flag -- toolchain
- [x] `metro.config.js`, `babel.config.js`, `drizzle.config.ts`, sample schema, generated `drizzle/` -- `.sql` loading -- migration proof
- [x] `src/spike/**`, `App.tsx` -- probe: cipher_version, one-transaction migration, Drizzle insert/select, core symbol, result lines on screen -- evidence
- [x] Release build on emulator via `pnpm --filter mobile android --mode nosmsRelease`; capture the screen text and the pulled DB header -- evidence
- [x] Debug bundle and release bundle of the core import -- AD-2 decision
- [x] `docs/decisions/S1-storage-migrations.md` -- verified answers, fallbacks, flag and Metro/Babel config, affected stories -- deliverable
- [x] Remove `src/spike/**` and probe `App.tsx`; run lint, typecheck, test:core, check:permissions, release build -- keep only confirmed config

**Acceptance Criteria:**
- Given the release build on an emulator, when the probe runs, then `PRAGMA cipher_version` is non-empty and the record states the flag location that works with hoisting.
- Given a drizzle-kit `expo` sample schema, when the release build opens the database, then the migration applies in one transaction and an insert/select round-trips.
- Given `apps/mobile` importing a core symbol, when bundled in debug and release, then the record confirms it or records the AD-2 fallback.
- Given the finished branch, when diffed against main, then it contains the record plus confirmed config only, and all CI gates pass.

## Implementation Notes

- Verified on a physical phone, release nosms build (emulator hit host OOM). Full results and decisions: `docs/decisions/S1-storage-migrations.md`. Probe commit `6f20c995245325b6b8b960e859aba9a84bdb4f55`.
- Deviations: drizzle-kit has no 0.45.x (used 0.31.11 with drizzle-orm 0.45.4). Stock `drizzle-orm/op-sqlite` driver is broken with op-sqlite 19; decision is sqlite-proxy plus `executeBatch` migrator. Header-byte check replaced by a keyless-open failure (release app not debuggable); CI header check stays with Story 1.6.
- Kept: SQLCipher flag, dependencies, Metro `sql` extension, Babel inline-import, `allowBuilds` esbuild entry. Probe, sample schema and `drizzle.config.ts` removed.

## Spec Change Log

## Review Triage Log

Iteration 0. Inline self-review (no review subagents launched; user did not authorize them). Diff: config, deps and decision record only.

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| 1 | Metro config calls `getDefaultConfig` twice | low | Harmless duplicate call; fix is cosmetic. | reject |
| 2 | New deps (`op-sqlite`, `drizzle-orm`) unused by shipped code | low | Intended: spike leaves confirmed config; 1.6 consumes them. Release build and permission check pass with them. | reject |
| 3 | Header-byte check not done; keyless-open used | medium | Release app not debuggable; record states this and assigns the CI header check to Story 1.6. | defer (recorded in decision record) |
| 4 | Dependencies not alphabetically ordered in package.json | low | Cosmetic. | reject |

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm check:lockfiles && pnpm lint && pnpm typecheck && pnpm test:core` -- expected: exit 0.
- `cd apps/mobile/android && ./gradlew assembleNosmsRelease processSmsReleaseMainManifest && cd ../../.. && pnpm check:permissions` -- expected: BUILD SUCCESSFUL, permissions pass.

**Manual checks:**
- Release build on emulator shows cipher_version, migration and round-trip lines; the pulled DB file header is not `SQLite format 3`.
