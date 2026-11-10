---
title: 'Story 3.11 - Receipt photos and source details survive edits'
type: 'feature'
created: '2026-11-10'
status: 'done'
route: 'oneshot'
baseline_commit: 'e713162'
---

## Intent

Implements the epic's Story 3.11 acceptance criteria (see epics.md) and PRD TXN-011, TXN-002, AD-9.

## Implementation Notes

- Migration 0010 adds `attachment` (id, transaction_id, kind, digest, size_bytes, created_at; unique per entry and digest).
- Core `capture/attachments.ts`: `AddAttachment` (`ALREADY_ATTACHED` for the same digest on the same entry), `RemoveAttachment` (row only; returns the file name so the caller deletes the file after the commit), `moveAttachments` (a merge carries every photo to the survivor, deduplicated by digest), `orphanFiles`, `SOURCES_SQL`. `TxSnapshot` now records attachment ids so a merge Undo puts photos back with their entry. Edits never touch attachments or `source_record`.
- Android: Kotlin module `ReceiptFilesModule` opens the Photo Picker (`MediaStore.ACTION_PICK_IMAGES`, or the system chooser before Android 13): no storage or camera permission; `check-permissions` still passes on both flavours. The image is read once, hashed (SHA-256) and written AES-256-GCM encrypted to `<private>/receipts/<attachment id>.enc`, with a key derived from the database key (HMAC-SHA256 with a fixed label). The file is written before the row commits; a duplicate or failure deletes it again.
- Mobile: the detail has `Add receipt photo`, thumbnails (a tap opens a full-screen viewer), and `Remove photo` behind a sheet reading `Remove this photo? It will be deleted from this phone.`; the row is deleted first and the file after the commit. The `Source` section lists every source with its kind and time. At start the orphan sweep deletes unreferenced files and clears decrypted copies from the cache.

## Deviation

- A decrypted temporary copy is written to the app cache so the image can be shown; it is cleared at the next start, not when the viewer closes.
- `As recorded: …` shows the source record's reference text; the entry's original source text is not stored separately yet (no capture source exists).
- When a merge drops a duplicate photo (same digest) the dropped row is not restored by Undo; its file is swept as an orphan.
- Photos are capped at 25 MB; there is no downscaling.
- The permission-spy requirement is covered by the existing `check-permissions` gate on the merged manifests rather than a new test.
- Not checked on a device with TalkBack.
