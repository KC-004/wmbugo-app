# Review: Verified-Current Lens (ARCHITECTURE-SPINE.md)

- **Lens:** Every committed decision should be web-researched or reality-checked, not asserted from training data: current versions, each named technology still exists and fits, and the live defaults it depends on.
- **Date:** 2026-11-07
- **Method:** WebSearch, plus live checks against the npm registry (`registry.npmjs.org`), the GitHub REST API (releases and repo status), Google Maven POMs and upstream READMEs. The memlog already verified four things: React Native 0.88.x, the Notifee archive and notify-kit replacement, the Drizzle op-sqlite driver, and the op-sqlite SQLCipher flag. This review covers every other named technology and re-checks those four where the facts have changed.

## Summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 2 |
| Medium | 6 |
| Low | 4 |
| Info | 3 |

No named technology is archived or deprecated. Every native library checked has a New Architecture build. None of them requires Firebase or push for the way the spine uses it. The real problems are one memlog assumption that the upstream docs contradict (where the SQLCipher flag goes), one Google SDK that quietly brings in telemetry and network transport, and several version facts that are stale or missing from the spine.

## Findings

### H1 — High — op-sqlite (SQLCipher config location)

- **Finding:** The memlog (AD storage line) says the `"op-sqlite": {"sqlcipher": true}` key goes "in pnpm workspace likely root package.json". The current op-sqlite installation docs say the opposite: *"In a monorepo, put the 'op-sqlite' config in your app's package.json (the folder above ios/ and android/). Android reads only that file."* A key placed only in the root applies to iOS but **not Android**. Because the build does not fail, Android would compile plain SQLite and the database would be **unencrypted**. That silently breaks SEC-001 and AD-7. The spine's open question ("SQLCipher build flag location in a pnpm workspace") is already answered upstream, and the answer contradicts the memlog's guess.
- **Source:** https://raw.githubusercontent.com/OP-Engineering/op-sqlite/main/docs/docs/installation.md (Configuration section, IMPORTANT box); https://github.com/OP-Engineering/op-sqlite
- **Action:** Close the open question in AD-7: the flag lives in `apps/mobile/package.json`, never only at the root. Add an AD-7 rule (and a CI or startup assertion) that the storage adapter runs `PRAGMA cipher_version` on open and refuses to continue if it returns empty. Add a test that a database file written by the app is unreadable without the key.

### H2 — High — Google ML Kit text recognition v2 (bundled)

- **Finding:** The bundled artifact `com.google.mlkit:text-recognition` is at **16.0.1**, last published **Aug 2024** (more than 2 years with no Android update; Google's release notes show no deprecation). Its transitive `com.google.mlkit:common:18.11.0` POM depends on **`transport-api`, `transport-backend-cct`, `transport-runtime`** (Google datatransport, a telemetry upload path), **`firebase-components`, `firebase-encoders`, `firebase-encoders-json`**, and `play-services-base/basement/tasks`. Google's ML Kit Android data-disclosure page says the SDKs *"collect device information, app information, performance metrics, and other data for diagnostics and usage analytics"* and send it over HTTPS. This sits badly with AD-17 ("No analytics ... or network SDKs") and the spirit of AD-11 ("no Firebase"). The M1 gate wording ("terms allow 'no data collected'") is partly answered already: by Google's own statement, ML Kit does collect. Whether the Play "no data collected" claim holds depends entirely on transmission being impossible once `INTERNET` is removed, so the gate has to prove that rather than read the terms.
- **Sources:** https://dl.google.com/android/maven2/com/google/mlkit/text-recognition/maven-metadata.xml ; https://dl.google.com/android/maven2/com/google/mlkit/common/18.11.0/common-18.11.0.pom ; https://developers.google.com/ml-kit/android-data-disclosure ; https://developers.google.com/ml-kit/release-notes
- **Action:** Rewrite the AD-12 gate as concrete evidence:
  1. The release APK's merged manifest has no `INTERNET` or `ACCESS_NETWORK_STATE` (the datatransport manifests declare them; `tools:node="remove"` must cover both).
  2. OCR works in airplane mode on a release build.
  3. AD-17 records an explicit exception for ML Kit's bundled telemetry stack (or excludes `transport-backend-cct` via Gradle `exclude` if OCR still works).
  4. A Data safety rationale is written down.

  Start the fallback engine evaluation (PaddleOCR/ONNX Runtime or Tesseract) in parallel during M1 rather than only after the gate fails, given the artifact's age.

### M1 — Medium — op-sqlite (version facts stale)

- **Finding:** The Stack table says "registry shows 15.x; unverified". The registry now shows **19.0.5** (published 2026-11-05). 19.0.0 shipped 2026-10-26; 18.2.5 (2026-09-20) bumped sqlite and SQLCipher, and 19.0.4 updated OpenSSL. That is four majors past what the spine records. The project is very active (non-archived, frequent releases), and peer deps are `react-native: *`. No release note mentions RN 0.88, so compatibility is unconfirmed but not contradicted. The memlog's "SQLCipher 4.8.0" note is also stale (upstream SQLCipher is 4.16.0, May 2026).
- **Sources:** https://registry.npmjs.org/@op-engineering/op-sqlite ; https://github.com/OP-Engineering/op-sqlite/releases ; https://www.zetetic.net/blog/2026/05/12/sqlcipher-4.16.0-release/
- **Action:** Replace "15.x; unverified" with "19.x (19.0.5 latest, 2026-11-05)". Pin in the M1 spike against RN 0.88.1, and read the 16→19 breaking-change notes (19.0.0 changed batch execution and rollbacks; error codes are now exposed).

### M2 — Medium — react-native-notify-kit (merged permissions)

- **Finding:** Status is good. The library is actively maintained (10.10.0, 2026-10-28; weekly releases), Invertase's archived Notifee README links to it, it uses TurboModules and is New-Architecture-only, and it has no Firebase dependency (FCM Mode is opt-in and needs `@react-native-firebase/*` installed separately). However, its library `AndroidManifest.xml` merges **`INTERNET`, `ACCESS_NETWORK_STATE`, `SCHEDULE_EXACT_ALARM`, `FOREGROUND_SERVICE`, `ACCESS_NOTIFICATION_POLICY`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `VIBRATE`** into the app. It also uses AlarmManager (exact) for trigger notifications by default, unlike Notifee's WorkManager. `SCHEDULE_EXACT_ALARM` and `FOREGROUND_SERVICE` trigger Play policy declarations. AD-15 only strips `INTERNET`. Note too that a different fork, `@felipe-software/react-native-notify-kit`, exists; the canonical package is the unscoped `react-native-notify-kit` from `marcocrupi`. It is maintained by one person.
- **Sources:** https://raw.githubusercontent.com/marcocrupi/react-native-notify-kit/main/packages/react-native/android/src/main/AndroidManifest.xml ; https://registry.npmjs.org/react-native-notify-kit ; https://dev.to/marco_crupi/notifee-is-archived-heres-a-maintained-new-architecture-drop-in-replacement-3ib5 ; https://docs.page/marcocrupi/react-native-notify-kit/fcm-mode ; https://github.com/felipe-software/react-native-notify-kit
- **Action:** In AD-15, make the APK permission check an **allowlist** (only expected permissions pass) instead of the current denylist. Add `tools:node="remove"` for `ACCESS_NETWORK_STATE`, `SCHEDULE_EXACT_ALARM` (the evening summary can use inexact/WorkManager triggers via the Scheduler port), `FOREGROUND_SERVICE` and `ACCESS_NOTIFICATION_POLICY` unless a story needs them. Pin the unscoped `react-native-notify-kit` package explicitly.

### M3 — Medium — Drizzle ORM / drizzle-kit with op-sqlite

- **Finding:** The current stable releases are `drizzle-orm` **0.45.4** and `drizzle-kit` **0.31.11**. Drizzle **1.0 is at rc.5** (2026-10-21) with peer `@op-engineering/op-sqlite >= 17`. 0.45.x declares `>= 2` and so has no stated test coverage against op-sqlite 19. 1.0 changes the drizzle-kit migration layout and the relational-query API (RQB v2), so a team on 0.45 now faces a migration soon. The current docs confirm the op-sqlite setup the spine relies on: drizzle-kit config `dialect: 'sqlite', driver: 'expo'`; bundling `.sql` needs `babel-plugin-inline-import` plus `sql` in Metro `sourceExts`; and `useMigrations` comes from `drizzle-orm/op-sqlite/migrator`. AD-7's "run transactionally on open with a pre-migration safety copy" is custom behaviour on top of `useMigrations`, which does neither.
- **Sources:** https://registry.npmjs.org/drizzle-orm ; https://registry.npmjs.org/drizzle-kit ; https://orm.drizzle.team/docs/connect-op-sqlite ; https://blog.logrocket.com/drizzle-react-native-expo-sqlite/
- **Action:** Decide 0.45 versus 1.0 in the M1 spike, preferring 1.0 if it reaches GA before project init. Record the `driver: 'expo'` and Metro/Babel settings in AD-7. State that the safety copy and transactional wrapper are adapter code around the Drizzle migrator, not a Drizzle feature.

### M4 — Medium — react-native-vision-camera

- **Finding:** **v5** shipped 2026-04-16 (latest 5.2.4, 2026-10-29). It is a rewrite on Nitro Modules, with peers `react-native-nitro-modules` and `react-native-nitro-image`. The v4 API is "largely gone", and CodeScanner and other plugins are now separate packages. AI coding agents trained mainly on v4 code will produce v4 calls that do not compile.
- **Sources:** https://github.com/margelo/react-native-vision-camera/releases/tag/v5.0.0 ; https://registry.npmjs.org/react-native-vision-camera ; https://margelo.com/blog/whats-new-in-visioncamera-v5/llms.txt
- **Action:** In the Stack table, write "VisionCamera 5.x (Nitro; requires react-native-nitro-modules and react-native-nitro-image)". Point agents at the v5 docs in project context, and confirm in the spike that the photo output feeds the ML Kit adapter.

### M5 — Medium — pnpm workspaces with React Native CLI/Metro

- **Finding:** pnpm is at **v12.18.0** (2026-11-05). Current guidance (Callstack, 2026) still recommends `node-linker=hoisted` for React Native monorepos, because Gradle, CocoaPods and some Metro paths assume a flat `node_modules`. It also recommends Metro `watchFolders` on the workspace root and disabling hierarchical lookup. Symlink support in Metro exists but is still incomplete for non-hoisted layouts. The spine says "pnpm only" but records no linker decision. The memlog's fallback ("single app + lint rule") is also missing from the spine. Combined with H1 (op-sqlite reads only the app's `package.json`), this makes the workspace layout a known risk point.
- **Sources:** https://callstack.com/blog/react-native-monorepo-with-pnpm-workspaces ; https://github.com/facebook/metro-bundler/issues/1 ; https://dev.to/heyradcode/surviving-pnpm-react-native-how-i-finally-stopped-metro-from-screaming-about-babelruntime-493i ; https://github.com/pnpm/pnpm/releases
- **Action:** Add `node-linker=hoisted` (root `.npmrc`) and the Metro workspace config to AD-2 as the starting setting. Bring the memlog fallback into the spine, and keep AD-2's compile-time boundary enforced through TS project references or a lint rule, since hoisting weakens dependency isolation.

### M6 — Medium — TanStack Query on React Native (offline defaults)

- **Finding:** `@tanstack/react-query` **5.107.1** is current and fits. However, the v5 default `networkMode: 'online'` pauses queries and mutations whenever `onlineManager` reports offline. The documented React Native recipe wires `onlineManager` to NetInfo, which in an airplane-mode, no-`INTERNET` app would report offline and pause **every local query**. The app would then show nothing. In RN the default `onlineManager` assumes online, so this only fails if someone follows the docs recipe, but that is exactly what an agent would do.
- **Sources:** https://tanstack.com/query/v5/docs/framework/react/reference/variables/onlineManager ; https://tanstack.com/query/latest/docs/framework/react/guides/network-mode ; https://registry.npmjs.org/@tanstack/react-query
- **Action:** Add to AD-13: set `networkMode: 'always'` in the QueryClient defaults for queries and mutations, never wire NetInfo to `onlineManager`, and wire `focusManager` to `AppState` only.

### L1 — Low — React Navigation

- **Finding:** Current stable is **7.5.1** (2026-10-13). **8.0 is still pre-release** (`8.0.0-alpha.51`, `next` tag); it requires React 19/RN 0.83+ and New Architecture only, and its docs warn the API may change. The spine leaves the major unpinned, so an agent could pull in `@next`.
- **Sources:** https://registry.npmjs.org/@react-navigation/native ; https://reactnavigation.org/docs/8.x/upgrading-from-7.x/ ; https://infoq.com/news/2026/04/react-navigation-8-alpha
- **Action:** In the Stack table, write "React Navigation 7.x (8.x alpha excluded until stable)".

### L2 — Low — react-native-keychain

- **Finding:** Maintained. **v11.0.0 was released 2026-11-06**, one day before this review. It moves to TurboModules and is New-Architecture-only; it requires RN ≥ 0.82, React ≥ 19.1.1, Node ≥ 20.19.4 and Android API 24+. On Android it stores data in Jetpack DataStore encrypted with an Android Keystore key, with `AES_GCM_NO_AUTH` as the non-auth cipher (since 9.2), which fits AD-8's "not bound to biometrics or PIN". It is brand new, so expect follow-up patches. "Available after the first unlock since boot" is iOS keychain wording. On Android the matching behaviour comes from credential-encrypted storage, so AD-9's post-unlock catch-up must tolerate the key being unreadable before first unlock (direct boot).
- **Sources:** https://github.com/oblador/react-native-keychain/releases/tag/v11.0.0 ; https://registry.npmjs.org/react-native-keychain ; https://socket.dev/npm/package/react-native-keychain/diff/9.2.0
- **Action:** Pin 11.0.x (take the first patch release if one lands before M1). Specify `storage: AES_GCM_NO_AUTH` explicitly in the KeyStore adapter. Add a spike check that the SMS job handles "key unavailable" before first unlock.

### L3 — Low — libsodium binding

- **Finding:** The spine says only "libsodium". The maintained choice is **`react-native-libsodium` (serenity-kit) 1.7.0** (2026-02-09, repo not archived, about 9 months since the last release). It requires the New Architecture and Android minSdk 24, and it exposes `crypto_aead_xchacha20poly1305_ietf_*` and `crypto_pwhash` (Argon2id) natively; `crypto_pwhash` needs `loadSumoVersion` only on web. Similarly named packages exist (`sodium-friends/react-native-libsodium`, `getify/...`, `react-native-sodium-jsi`), so an unnamed dependency invites the wrong one.
- **Sources:** https://registry.npmjs.org/react-native-libsodium ; https://github.com/serenity-kit/react-native-libsodium ; https://www.github.com/sodium-friends/react-native-libsodium
- **Action:** Name `react-native-libsodium` (serenity-kit) in AD-8 and the Stack table. Since backup crypto is pure computation, consider running it in `packages/core` with `libsodium-wrappers-sumo` (Node-testable) and using the native binding only as a performance adapter.

### L4 — Low — React Native version

- **Finding:** The memlog's verification holds: **0.88.1** is `latest` (2026-10-27). However, **0.89.0-rc.0** was published 2026-11-04, so 0.89 stable is likely within weeks of project init. A secondary report says 0.88 has no user-facing breaking changes. The legacy architecture was removed in 0.82 to 0.84, so every library in this stack must be New-Architecture-only, which they all are.
- **Sources:** https://registry.npmjs.org/react-native ; https://alternativeto.net/news/2026/10/react-native-0-88-brings-web-based-event-dispatching-and-variable-fonts-no-breaking-changes/
- **Action:** Pin 0.88.1 at init. Re-check whether 0.89 is GA at M1 and decide upgrade timing explicitly.

### I1 — Info — react-native-android-widget

- **Finding:** Actively maintained (0.26.0, 2026-10-29; 4 releases in October 2026; 3 open issues) and supports the New Architecture. The `expo >= 54` peer is optional, so it works in bare RN CLI. It fits AD-10, which has the widget render only a snapshot. It is still a 0.x version.
- **Sources:** https://registry.npmjs.org/react-native-android-widget ; https://saleksovski.github.io/react-native-android-widget ; https://github.com/sAleksovski/react-native-android-widget
- **Action:** None beyond the existing spike choice against Glance. Pin 0.26.x if chosen.

### I2 — Info — Maestro

- **Finding:** Active (CLI 2.12.1, 2026-11-02). `setAirplaneMode` is **Android-only** (a no-op on iOS and web), which matches the spine's Android-only Phase 1 testing.
- **Sources:** https://docs.maestro.dev/reference/commands-available/setairplanemode ; https://github.com/mobile-dev-inc/maestro/releases
- **Action:** When iOS arrives in Phase 2, guard airplane-mode flows so they don't pass vacuously on iOS.

### I3 — Info — Zustand, fast-check

- **Finding:** Current releases are Zustand **5.1.0** (2026-11-06) and fast-check **4.10.2**. Neither is archived, and both fit.
- **Sources:** https://registry.npmjs.org/zustand ; https://registry.npmjs.org/fast-check
- **Action:** Pin at init as planned.

## Not contradicted

- No spine technology requires Firebase or push for its intended use. notify-kit's FCM Mode is opt-in, and ML Kit's Firebase *encoder/component* libraries are transitive packages only (see H2).
- The memlog's Notifee archive and notify-kit replacement claims are confirmed.
- The Drizzle op-sqlite driver exists in both 0.45.x (`drizzle-orm/op-sqlite`, `/migrator`) and 1.0 rc.
