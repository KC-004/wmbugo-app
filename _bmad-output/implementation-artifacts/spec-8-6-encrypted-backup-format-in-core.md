---
title: 'Story 8.6: Encrypted backup format in core'
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

**Problem:** There is no backup file. A lost phone loses everything, and a copied file would reveal it.

**Approach:** A `Crypto` port, and in core a writer and a reader for one encrypted file: Argon2id-derived key, XChaCha20-Poly1305 secretstream in 64 KiB chunks, a manifest with sizes, digests and balances, typed errors, and strict validation of every entry.

## Boundaries & Constraints

**Always:** typed `Result` errors (`NOT_A_WMBUGO_BACKUP`, `WRONG_PASSPHRASE`, `BACKUP_DAMAGED`, `BACKUP_TOO_NEW`, `FILE_TOO_LARGE`); the manifest is decrypted alone for a preview; the backup module writes only through injected handles.

**Never:** no plaintext outside memory or injected staging; no file system or FileStore import in the module (lint rule).

</frozen-after-approval>

## Tasks & Acceptance

- [x] `ports/crypto.ts` -- the port: random bytes, SHA-256 (one-shot and streaming), Argon2id, secretstream push and pull
- [x] `backup/format.ts`, `writer.ts`, `reader.ts` -- header, manifest, entry validation, `writeBackup`, `readManifest`, `extractBackup`
- [x] `backup/secretstream.ts` -- libsodium-compatible secretstream in pure TypeScript and `createPureCrypto`
- [x] `testing/sodiumCrypto.ts` -- the Node adapter on `libsodium-wrappers-sumo`
- [x] `apps/mobile/src/adapters/backup/rnCrypto.ts` -- the phone adapter: Argon2id and random bytes from `react-native-libsodium`, the rest in core
- [x] ESLint rule for `packages/core/src/backup/**`; tests: 42 format and validation, 5 secretstream compatibility, 1 mobile adapter

## Implementation Notes

- **Header** is 76 bytes in the clear: magic, version, Argon2id parameters, salt, a 16-byte passphrase verifier (`sha256(context || key)`), the secretstream header. The verifier is what separates `WRONG_PASSPHRASE` from `BACKUP_DAMAGED`.
- **Found by the exhaustive byte-flip test:** Argon2 rounds the memory limit down to KiB, so flipping a low bit of the stored `memlimit` produced the same key and the file still opened. The reader and writer now require the memory limit to be a whole number of KiB. Every single-byte flip of a small backup now fails (magic or version: `NOT_A_WMBUGO_BACKUP`; parameters: `WRONG_PASSPHRASE` or `BACKUP_DAMAGED`; salt and verifier: `WRONG_PASSPHRASE`; everything after: `BACKUP_DAMAGED`).
- **Mobile crypto:** `react-native-libsodium` does not expose the secretstream or SHA-256, and Hermes cannot run libsodium WebAssembly. The secretstream is therefore implemented in TypeScript on `@noble/ciphers` and proved byte-compatible with libsodium in both directions (property test and a cross-written backup). libsodium pads the Poly1305 input with `(16 - 64 + n) & 15` bytes rather than the usual AEAD padding; this is reproduced exactly.
- Speed on a phone (pure JS ChaCha20 and Poly1305 in Hermes) is not measured; Story 8.7's progress view must be tried on the device with a large backup.
- Core now depends on `libsodium-wrappers-sumo` (dev, tests), `@noble/ciphers` 1.3.0 and `@noble/hashes` 1.8.0 (pure TypeScript). The mobile app depends on `react-native-libsodium` 1.7.0. The dependency denylist gate still passes.
- The SQLCipher `db` entry keyed with the archive key is produced by Story 8.7 (it needs the database); this story carries the key in the manifest and streams whatever bytes it is given.
- Checks: lint and typecheck clean, core 993 tests, mobile adapter test passes; `assembleNosmsDebug` is being built to prove the native library links.
