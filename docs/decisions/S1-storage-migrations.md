# S1 — Encrypted storage and migration toolchain

Status: decided 2026-11-08. Story 1.2. Probe commit: `6f20c995245325b6b8b960e859aba9a84bdb4f55` (harness under `apps/mobile/src/spike/`, removed afterwards).

Verified on a physical Android phone (Xiaomi, release build, `nosms` flavor, keystore = template debug key) with pnpm 12.18.0 `nodeLinker: hoisted`, RN 0.88.1, op-sqlite 19.0.5, drizzle-orm 0.45.4, drizzle-kit 0.31.11.

## Summary

| Question | Result |
|----------|--------|
| SQLCipher via op-sqlite with hoisted workspace | Confirmed |
| Encrypted at rest | Confirmed (opening without the key fails) |
| drizzle-kit `driver: 'expo'` `.sql` files via Metro/Babel in release | Confirmed |
| Migration applies in one transaction | Confirmed, with `executeBatch` (not Drizzle's own migrator) |
| Drizzle insert/select through the op-sqlite driver | **Changed**: stock `drizzle-orm/op-sqlite` driver does not work; use `drizzle-orm/sqlite-proxy` |
| `apps/mobile` imports from `packages/core` | Confirmed in debug and release. **AD-2 fallback not needed.** |

## 1. SQLCipher flag

Location: the root of **`apps/mobile/package.json`** (the app, not the workspace root):

```json
"op-sqlite": { "sqlcipher": true }
```

op-sqlite's `android/build.gradle` finds it by treating `rootDir/../package.json` (the Gradle root is `apps/mobile/android`) as the app's package.json. This works with `node-linker=hoisted` although op-sqlite itself sits in the root `node_modules`. No other Gradle change was needed beyond Story 1.1's hoisted paths; autolinking picked op-sqlite up.

Evidence (release build, fresh install): `PRAGMA cipher_version` returned `4.19.0 community`; `isSQLCipher()` returned `true`.

Encrypted at rest: reopening `spike.db` without `encryptionKey` fails with `file is not a database (code 26)`. The release app is not debuggable, so `run-as` could not pull the file; the keyless-open test replaces a header read. **Story 1.6 must still add the CI header check** (file header must not read `SQLite format 3`), ideally on a debuggable CI build.

API note: in op-sqlite 19 `executeRaw` returns `{ rawRows, columnNames, rowsAffected }`, not an array; `execute` is async and returns `{ rows }`.

## 2. Migrations: Metro/Babel config

drizzle-kit 0.45.x does not exist. Drizzle ORM 0.45.x pairs with drizzle-kit 0.31.x; the stable kit (0.31.11) was used.

`drizzle.config.ts`: `dialect: 'sqlite'`, `driver: 'expo'`, `schema`, `out: './drizzle'`. `drizzle-kit generate` emitted `drizzle/0000_*.sql`, `meta/_journal.json` and `drizzle/migrations.js` (imports the journal and each `.sql` as a string).

Config that works (the Babel and Metro entries are kept in the repo; the type declaration goes with the adapter in 1.6):

- `babel.config.js`: `plugins: [['inline-import', { extensions: ['.sql'] }]]` (`babel-plugin-inline-import@3.0.0`).
- `metro.config.js`: `resolver.sourceExts: [...defaults, 'sql']`.
- A `*.sql` module declaration (`declare module '*.sql' { const c: string; export default c; }`) for TypeScript.

The release bundle (Hermes) contained the migrations and ran them.

pnpm 12 needs `esbuild: false` under `allowBuilds` in `pnpm-workspace.yaml` (drizzle-kit pulls esbuild; its build script is not needed).

## 3. Drizzle driver: stock op-sqlite driver does not work

`drizzle-orm@0.45.4/op-sqlite` calls `client.execute(...).rows?._array` synchronously (the pre-19 API). With op-sqlite 19 `execute` is async, so reads break: the insert succeeded, then `select` threw `TypeError: undefined is not a function` in a release build. Also, `drizzle-orm/sqlite-proxy/migrator` and the stock `migrate` read migrations from disk or run through the driver's own session and are unsuitable.

**Decision:** Story 1.6's adapter uses `drizzle-orm/sqlite-proxy`, wrapping op-sqlite:

```ts
const orm = drizzle(async (sql, params, method) => {
  const res = await db.executeRaw(sql, params);
  return { rows: method === 'get' ? (res.rawRows[0] ?? []) : res.rawRows };
});
```

and its own small migrator over the drizzle-kit bundle (`migrations.journal` + `migrations.migrations.mNNNN`): create a bookkeeping table, skip applied indexes, split each file on `--> statement-breakpoint`, and run all pending statements plus the bookkeeping inserts in **one `db.executeBatch([...])`**. op-sqlite runs `executeBatch` in a single native transaction.

Evidence: first launch ran 2 statements (create table + bookkeeping row); relaunch ran 0. A batch of `CREATE TABLE atom_a` followed by an insert into a missing table threw and left no `atom_a` (rolled back). A Drizzle insert then select (`a|12345|x`) round-tripped.

Not tested (left to Story 1.6): the safety copy before migrating, `schema_migration` naming, `BEGIN IMMEDIATE` writes (Story 1.7), hash-based drift checks.

## 4. Workspace: core import (AD-2)

`apps/mobile` imports `CORE_PACKAGE` from `@wmbugo/core` and it resolves and runs in the release build on the phone and in a dev bundle (`react-native bundle --dev true`). Story 1.1's Metro `watchFolders`/`nodeModulesPaths` setup is sufficient. No change to Story 1.1's layout.

## 5. Open items and affected stories

- **Story 1.6**: use the sqlite-proxy adapter and `executeBatch` migrator above; add the encrypted-header CI check; real key via KeyStore, never the spike key.
- **Story 1.5**: drizzle-kit is 0.31.x in practice; schema files should live where drizzle.config can reach them. The generated `drizzle/` folder was not kept (re-generate in 1.5/1.6).
- **Story 1.7**: transactions for the writer must use op-sqlite's `transaction`/`executeBatch` (verify `BEGIN IMMEDIATE` there).
- **Epic text**: "drizzle-kit 0.45.x" in Story 1.2 and AD-8 should read "drizzle-orm 0.45.x with drizzle-kit 0.31.x".
- **Environment (not a product blocker)**: on a 7.5 GB Windows machine, release bundling ran out of memory while an emulator was running; close the emulator or use a device. `pnpm install` on Windows failed with "Access is denied" until `node_modules` was deleted and reinstalled cleanly.

## What the spike left in the repo

Kept (confirmed): the op-sqlite SQLCipher flag, op-sqlite/drizzle-orm/drizzle-kit/inline-import dependencies, the Metro `sql` extension, the Babel inline-import plugin, the `allowBuilds` entry. Removed: the probe, sample schema, generated sample migration and `drizzle.config.ts`.
