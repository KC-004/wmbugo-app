---
title: 'Story 1.1 — Starter workspace, Android flavors and CI gates'
type: 'chore'
created: '2026-11-08'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '38586318939405c3335181a70dc57657e5a8b2c5'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repo has no code. Every later story needs the agreed workspace layout, a core/mobile boundary the toolchain enforces, both Android flavors, and CI that proves each push builds with no forbidden permissions.

**Approach:** Scaffold a pnpm workspace (hoisted) holding pure-TS `packages/core` and an RN CLI 0.88.1 app in `apps/mobile`. Add the `nosms`/`sms` flavors and backup exclusions. Enforce boundaries with lint and typecheck. Wire a GitHub Actions pipeline plus a pre-push hook. The app shows only a placeholder screen.

## Boundaries & Constraints

**Always:**
- One `pnpm-lock.yaml`; `node-linker=hoisted`; `packageManager` pinned in root `package.json`.
- `packages/core` depends on nothing RN, Drizzle or op-sqlite; `apps/mobile` depends on `core` (`workspace:*`), never the reverse.
- TS strict in both packages.
- `applicationId app.wmbugo`, minSdk 26 / targetSdk 36 / compileSdk 36. Flavor dimension `capture` with `nosms` and `sms`.
- `INTERNET` declared only in the debug manifest. Release manifests carry only allowlisted permissions. Library-added extras are removed with `tools:node="remove"`.
- `allowBackup="false"`, plus data-extraction rules (API 31+) and full-backup rules (API <31) that exclude everything.

**Never:** No app features, database, design tokens or navigation (later stories). No SMS permission in any flavor yet. No analytics, crash-reporting or network SDK. No `console.log` in `src`. Do not edit planning artifacts.

**Decisions (human, 2026-11-08):**
- BMad tooling (`_bmad/`, `.claude/`, `.agents/`, `skills-lock.json`, `input/`) is committed to the repo, in its own commit, not ignored. Only the generated render cache `_bmad/render/` is gitignored.
- pnpm is installed globally with `npm i -g pnpm@12.18.0`, and `packageManager` pins `pnpm@12.18.0`.
- The spec stays whole (about 1,900 tokens), with no split.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Boundary import | `packages/core/src/x.ts` imports `react-native` / `drizzle-orm` / `@op-engineering/op-sqlite` | `pnpm lint` and `pnpm typecheck` both fail with a boundary message | Non-zero exit |
| console.log | `console.log` in core or mobile `src` | `pnpm lint` fails | Non-zero exit |
| Foreign lockfile | `package-lock.json` or `yarn.lock` anywhere | `check-lockfiles` fails | Non-zero exit, names the file |
| Forbidden permission | Merged release manifest contains `INTERNET`, `ACCESS_NETWORK_STATE` or any non-allowlisted permission | `check-permissions` fails | Lists each offending permission |
| Clean release | Both flavors' release manifests | `check-permissions` passes | — |

</frozen-after-approval>

## Code Map

- `README.md` -- existing, UTF-16 encoded; rewrite as UTF-8 with setup commands.
- Everything else is new. RN template source: `@react-native-community/template@0.88.1`, generated into `apps/mobile` with `npx @react-native-community/cli init`, then moved/renamed (`--skip-install --skip-git-init`, package `app.wmbugo`).
- Template `android/app/src/main/AndroidManifest.xml` declares `INTERNET`; move it to `src/debug/AndroidManifest.xml`.
- Toolchain on this machine: Node 26.13, JDK 17, Android SDK platforms 36/37, build-tools 36, NDK 27.1.

## Tasks & Acceptance

**Execution:**
- [x] Machine + tooling -- `npm i -g pnpm@12.18.0`; commit the BMad tooling folders in a separate commit before any scaffold, with `_bmad/render/` in `.gitignore`.
- [x] `package.json`, `pnpm-workspace.yaml`, `.npmrc` (`node-linker=hoisted`), `.gitignore`, `.nvmrc` (24) -- workspace root; scripts `lint`, `typecheck`, `test:core`, `check:lockfiles`, `check:permissions` -- single entry point for CI and the hook.
- [x] `tsconfig.base.json` -- strict base config shared by both packages.
- [x] `packages/core/{package.json,tsconfig.json,jest.config.js,src/index.ts,src/index.test.ts}` plus `src/{ports,usecases,writer,ledger,capture,learning,planning,insights,profile,backup,shared}/.gitkeep` -- pure-TS core with one smoke test.
- [x] `apps/mobile/**` -- RN 0.88.1 template (New Architecture and Hermes on, TS strict), `src/{features,shared,adapters}/.gitkeep`, placeholder `App.tsx` ("wmbugo" text, no network). `metro.config.js` watches `packages/core`.
- [x] `apps/mobile/android/app/build.gradle` -- applicationId, SDK levels, `flavorDimensions "capture"`, `nosms`/`sms`.
- [x] `apps/mobile/android/app/src/main/AndroidManifest.xml`, `src/debug/AndroidManifest.xml`, `res/xml/data_extraction_rules.xml`, `res/xml/backup_rules.xml` -- backup exclusion; INTERNET only in debug.
- [x] `eslint.config.mjs` -- flat config: `no-console` on `src`; `no-restricted-imports` for the three modules in `packages/core/**`.
- [x] `packages/core/tsconfig.json` `paths` -- map the three forbidden modules to a non-existent stub so typecheck fails even with hoisted `node_modules`.
- [x] `scripts/check-lockfiles.mjs` -- fail on any foreign lockfile (excluding `node_modules`).
- [x] `scripts/check-permissions.mjs` + `scripts/android-permission-allowlist.json` -- parse the merged release manifests of both flavors; fail on anything not allowlisted or on the two banned ones.
- [x] `.github/workflows/ci.yml` -- on every push: pnpm install (frozen), lockfile check, lint, typecheck, core tests, `assembleNosmsRelease`, permission check. Any failing step fails the run.
- [x] Pre-push hook (`simple-git-hooks`, installed by `postinstall`) -- runs `pnpm test:core`; blocks the push on failure.
- [x] `scripts/__fixtures__` + a test run -- prove each I/O-matrix failure case fails (temporary bad file, then removed).

**Acceptance Criteria:**
- Given a fresh clone, when `pnpm install` runs, then it installs from the single lockfile with hoisting.
- Given the workspace, when inspected, then the folder skeleton matches the story exactly.
- Given the Android project, when `assembleNosmsRelease` and `assembleSmsRelease` run, then both succeed with the required ids and SDK levels.
- Given the debug build on an emulator, when launched, then the placeholder screen renders.

## Implementation Notes

- pnpm 12 ignores `node-linker` in `.npmrc`; `nodeLinker: hoisted` is set in `pnpm-workspace.yaml` (`.npmrc` keeps the line too). pnpm 12 also fails install on unapproved build scripts, so `allowBuilds: { simple-git-hooks: false }` is set (the root `postinstall` installs the hook).
- TS `paths` to a missing file does not fail: TS falls back to `node_modules` (hoisted `react-native` resolved). The stubs therefore exist (`packages/core/__forbidden__/*.ts`) and each contains a deliberate type error whose message reads "Boundary: packages/core must not import …".
- Hoisting: `settings.gradle` and the `react {}` block point at the root `node_modules` (`reactNativeDir`, `codegenDir`, `cliFile`, `hermesCommand`); Metro watches `packages/core` and the root `node_modules`.
- Windows only: CMake pinned to 4.1.2 (ninja 1.12, long-path aware); the default ninja 1.10 fails on >260-char codegen paths. Linux CI keeps the default.
- No library currently adds a permission beyond the allowlisted `${applicationId}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, so no `tools:node="remove"` entries were needed. A blanket release-side removal was deliberately not added, because it would mask an `INTERNET` mistakenly added to `main`.
- CI builds `assembleNosmsRelease` plus `processSmsReleaseMainManifest` so the permission check covers both flavors.
- `pnpm test:gates` (scripts/test-gates.mjs + scripts/__fixtures__) runs all I/O-matrix cases (13/13 pass).

## Spec Change Log

## Review Triage Log

Iteration 0. Layers: blind (B), edge-case (E), verification-gap (V).

| # | Finding | Verdict | Evidence | Route |
|---|---------|---------|----------|-------|
| B1/V1/E16 | `pnpm test:gates` never runs in CI; README says "same as CI" | medium | `ci.yml` has no gates step; only `package.json:15` references it. A disabled rule or deleted stub stays green. | patch |
| B3/V2/E14 | sms release APK never assembled in CI | low | CI runs `processSmsReleaseMainManifest` only; an sms-only compile/package failure would pass. One-word fix. | patch |
| B2/V3 | Mobile Jest test never runs and asserts nothing | low | No script/CI step runs `--filter mobile test`; test has no `expect`. | patch |
| V5 | Untested parser branches: `uses-permission-sdk-23`, `tools:node="remove"`, nested `pnpm-lock.yaml` | low | Fixtures contain only plain `<uses-permission>`; lockfile cases omit nested pnpm lock. Adding cases is direct. | patch |
| V-other/E1 | `gradlew` will be committed 100644 (`core.filemode=false`), CI `./gradlew` fails | high | `git config core.filemode` → false; file untracked. Fix at commit with `git add --chmod=+x`. | patch (commit time) |
| B4/E10/E11 | Core boundary misses `react-native-*`, `@react-native/*`; `.tsx` in core skips typecheck guard and Jest transform | low | ESLint `paths` names three exact modules; core `include` is `src/**/*.ts`; jest transform `\.ts$`. Glob widening is direct. | patch |
| E12 | Core Jest cannot transform `.tsx` | low | Same root as above (core `.tsx` unsupported). | patch (grouped) |
| E9 | `require('react-native')` in core `.js` bypasses ESLint | low | Real, but core is TS-only; needs a new syntax rule. Unlikely in everyday use. | reject |
| B7a | No top-level `permissions: contents: read` in CI | low | Default token scope depends on repo setting; two-line direct fix. | patch |
| E13 | `cancel-in-progress: true` on main can leave main commits without a completed run | low | Concurrency group per ref cancels earlier main runs. Direct expression fix. | patch |
| B10 | Node engines disagree (`>=24` root vs `>= 22.11.0` mobile) | low | `apps/mobile/package.json` keeps template range. Direct correction. | patch |
| B13a | `__gate_*` temp files not gitignored | low | `test-gates.mjs` writes `__gate_*.ts` into src; an interrupted run can leave them staged-able. One-line fix. | patch |
| V4 | Backup exclusion (`allowBackup`, rule refs) has no automated check | low | Correct today (verified in merged manifest); regression needs an explicit edit of a commented line. Fix is a new gate, beyond the intent's "builds with no forbidden permissions". | reject |
| B7b | No `pull_request` trigger | false | Intent says "every push"; same-repo PR branches are pushes. | reject |
| B7c | No artifact upload on failure | low | Convenience only; adds steps. | reject |
| B8/E2 | Stale merged manifest can pass locally | low | CI builds fresh; README orders build-then-check. Fix adds mtime guards. | reject |
| E3 | Multiple manifests under variant dir | maybe-false | AGP 9 writes one `process<Variant>MainManifest/AndroidManifest.xml`; would need another AGP layout to occur. Low if true. | reject |
| B8b/E5 | Malformed allowlist throws raw TypeError | false | Throws → non-zero exit; loud failure is correct behaviour. | reject |
| E4 | Single-quoted `android:name` skipped | false | Merged manifest is AGP-generated with double quotes (checked `processNosmsReleaseMainManifest/AndroidManifest.xml`). | reject |
| B9 | No per-flavor allowlist / SMS ban for nosms | false | No SMS permission exists in any flavor; nothing to leak until Epic 13. | reject |
| B5 | No positive control in `test-gates` | low | Each case asserts a specific message (`Boundary: …`, `no-console`, file name); CI lint/typecheck prove the clean baseline. | reject |
| B6 | Gradle wrapper, keystore, mipmaps missing | false | Present on disk; excluded only from the review diff as binaries. | reject |
| B11 | Jest globals allowed in `apps/mobile/src` | low | typescript-eslint disables `no-undef` for TS and mobile tsconfig already includes `jest` types; affects only `.js` in src. | reject |
| B12 | No Prettier gate; iOS scaffolding kept | false | Not required by intent; spec keeps the RN template, noted in Implementation Notes. | reject |
| B13b/E8 | SIGINT leaves gate files behind | low | Next run refuses to overwrite with a clear error; signal handlers add complexity. | reject |
| B13c | `shell: true` with quoted paths | low | Repo path with `"`/`$` is not a realistic case. | reject |
| E6 | `check-lockfiles` prints OK with no root lockfile | low | CI `--frozen-lockfile` fails first; adding a guard. | reject |
| E7 | `vendor/bundle` may hold foreign lockfiles | maybe-false | Would need a gem shipping `package-lock.json`; Android-only, no `bundle install`. Low if true. | reject |
| E15 | Lockfiles under `build`/`Pods` dirs not flagged | low | Those dirs are gitignored build output. | reject |

## Design Notes

Hoisting means `react-native` is resolvable from core at runtime, so a missing dependency can't enforce the boundary. Two independent guards do it instead: the ESLint `no-restricted-imports` rule, and core-only TS `paths` such as `"react-native": ["./__forbidden__/react-native"]` pointing at a file that doesn't exist (TS2307). Release signing stays on the template's debug keystore until store setup in Epic 14.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm check:lockfiles && pnpm lint && pnpm typecheck && pnpm test:core` -- expected: all exit 0.
- `cd apps/mobile/android && ./gradlew assembleNosmsRelease assembleSmsRelease` -- expected: BUILD SUCCESSFUL.
- `pnpm check:permissions` -- expected: passes for both flavors; it fails if `INTERNET` is temporarily added to the main manifest.

**Manual checks:**
- `pnpm --filter mobile android --mode nosmsDebug` on an emulator shows the placeholder screen.
