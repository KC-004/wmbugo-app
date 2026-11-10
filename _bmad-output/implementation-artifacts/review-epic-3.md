# Epic 3 independent review (2026-11-10)

Three read-only reviewers covered the Epic 3 range (`1e40370..HEAD`): core ledger and capture logic, mobile UI and accessibility, and the seams (migrations, native photo module, search index, retention). Findings were checked against the code before fixing.

## Fixed (with regression tests)

| # | Finding | Fix |
|---|---------|-----|
| 1 | A reversed purchase could be deleted, rejected, edited or split, breaking the net-to-zero balance; Restore brought it back as confirmed | Those actions refuse a reversed entry (`NOT_REMOVABLE` / `NOT_EDITABLE` / `NOT_SPLITTABLE`); `RestoreDeleted` keeps `reversed` |
| 2 | `SetStartingBalance` ignored reversed entries | Counts `confirmed` and `reversed` like every other balance query |
| 3 | A held duplicate whose match was purged could not be approved, kept or merged; a merge against a deleted match hid both entries | Purge resolves the candidates that pointed at it; `ApproveCapture` ignores a candidate whose match is gone; `MergeDuplicate` refuses a removed match (`MATCH_REMOVED`) |
| 4 | Reversing a purchase that has a linked refund credited the refund twice; a purchase could be edited or re-split below its refunds | `HAS_REFUNDS` on Reverse; `BELOW_REFUNDS` on Edit and SetSplits |
| 5 | `needs_category` was cleared only by the bulk move, and bulk Undo did not restore it | Edit and SetSplits clear it; bulk Undo restores the flag |
| 6 | Undo of a merge lost a photo dropped because the survivor had the same image | The merge records dropped rows in its undo data and Undo re-inserts them; Undo also refuses when an entry was purged meanwhile |
| 7 | `RestoreRejected` confirmed a capture that still needed a decision | It returns to waiting when a candidate is open or there is no posting |
| 8 | SMS-sourced refunds and transfers were stored as manual | `SubmitCapture` keeps source kind and reference on all branches |
| 9 | Undone adds were listed under Recently deleted | The list shows only entries deleted with Delete (status excluded) |
| 10 | Selection-mode Back handler swallowed Back on other tabs; selection survived a filter change | Handler only while Activity is focused; selection ends on leaving or on a filter change |
| 11 | Amount filters assumed 2 decimals | The profile's exponent is used |
| 12 | A foreign charge was always posted to the first account | The card has an account chooser |
| 13 | First tap on Save or Cancel in the refund form only closed the keyboard; Reverse stayed visible beside an open form | `keyboardShouldPersistTaps`; Reverse hidden while the form is open |
| 14 | Out-of-order category previews in the bulk sheet; double Restore; stale "Refund for" after Save and add another; photo query running with no photo | Guarded or reset |
| 15 | A failed decrypt left partial plaintext in the cache | Decrypt to a temporary name and rename only after the tag verifies |

## Not fixed (recorded)

- Keep both and Merge on a held Activity row are not separate TalkBack actions; the row opens the review queue where they are reachable.
- Undo handlers that ignore a failed Undo (review queue, Recently deleted, detail restore) stay silent.
- Foreign amounts in the spoken row label assume 2 decimals (the row carries no foreign exponent).
- Review-queue times use the device time zone.
- The LIR-06 architecture test matches identifiers and file names only.
- The merge Undo of a dropped photo cannot recover its file if the app restarted between the merge and the Undo (the orphan sweep removes it).
