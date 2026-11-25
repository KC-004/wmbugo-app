# Epic 10 code review (2026-11-25)

## Scope

- Reviewed now: stories 10.1 to 10.4 (`838c7c6..b21ceae`), and story 10.10 with the later fixes (`1127156..9fbf554`).
- Reviewed earlier: stories 10.5 to 10.9 (`/code-review high` on 2026-11-24, fixes in `1127156`).
- Left out of the diff: test fixtures, generated Drizzle metadata, the lockfile and BMad documents.
- Layers: blind hunter, edge case hunter, verification gap, acceptance auditor, once per chunk. All eight reported.
- Checked in triage: findings marked **(run)** were reproduced with a temporary Jest test, since removed. The others in Decisions and Patches were read in the code at HEAD, or rest on the reviewer's cited evidence where marked **(reviewer)**.
- Nothing was run on a phone.

## Decisions needed

All five were decided by the product owner on 2026-11-25 (every recommended option). Each is now a patch.

- [x] **D1 (high) Tax-inclusive receipts cannot be saved as read (run).** `Bread 6.90 / TOTAL 6.90 / VAT included 1.15` reads tax 1.15 on top of the items, so the allocation is a mismatch until the tax is zeroed by hand. This is the normal receipt in the UK, EU, India and Singapore. [parseReceipt.ts, allocateReceipt.ts]
  - Options: (a) treat taxes as included when items + fees - discounts equals the total (recommended); (b) decide by region; (c) defer.
  - **Decided (a): treat taxes as included when items + fees - discounts equals the total.**
- [x] **D2 (high) A summary word inside a line breaks the item list (run).** `Colgate Total 3.50` is read as a total, and every item from there on is lost, including the lines after it. A fee or tax line printed between items does the same (reviewer). [parseReceipt.ts `classify`, `summaryStart`]
  - Options: (a) count a line as summary only when the text before the amount is essentially the keyword, and start the summary at the last summary block (recommended); (b) defer to tuning on real photos.
  - **Decided (a): tighten summary line detection and start the summary at the last summary block.**
- [x] **D3 (high) A receipt in another currency is a dead end.** `SaveReceipt` returns `CURRENCY_DIFFERS`, no screen edits the currency, and one stray ISO code on a local receipt triggers it. Story 10.4 asks for the Story 3.10 foreign-amount path. A symbol-only foreign receipt is recorded silently in the profile currency. [saveReceipt.ts:65]
  - Options: (a) add a currency correction row now, build the foreign path later (recommended); (b) build the full foreign path; (c) keep deferred.
  - **Decided (a): add a currency correction row now; the foreign-amount path stays deferred.**
- [x] **D4 (medium) Receipt lines go stale after an edit.** `SetSplits` and entry edits never update `receipt_item`, so the saved lines can contradict the entry's amount and categories. [splits.ts, editCommands.ts]
  - Options: (a) delete the lines when splits or amount change, with Undo restoring them; (b) keep them as a record of the paper receipt and label them so (recommended).
  - **Decided (b): keep the lines as the record of the paper receipt and label them so.**
- [x] **D5 (medium) The Add sheet and review redesign differs from the specs.** Keys 56dp to 48dp with a smaller type role; 4 quick categories instead of 6; tiles instead of chips; amount above categories; `Snap receipt` no longer first in the chip row; keypad hidden while `More` is open; local smaller type sizes on the review; changed wording (`Tap to confirm total`, the Not itemised hint, `Save & add another`, `Add details`). The spoken total label still says the old wording.
  - Options: (a) accept the redesign, record the deviations in the specs and fix the spoken label (recommended); (b) restore the specified values.
  - **Decided (a): accept the redesign, record the deviations in the specs and fix the spoken total label.**

## Patches

### High
- [x] **P1 Release builds can ship without OCR.** The models are not in git and neither Gradle nor CI fetches or checks them; the build passes and every scan says unavailable. CI also never runs the Kotlin OCR tests, which skip silently without models. [.github/workflows/ci.yml, apps/mobile/android/app/build.gradle]
- [x] **P2 A receipt saved with no category never reaches `Add a category`.** `SaveReceipt` clears `category_set_by` but never sets `needs_category = 1`, which the review queue and row tag read. The existing test asserts only `category_set_by`. [saveReceipt.ts:114-117]
- [x] **P3 A quantity merges into the price (run).** `Basmati rice 1 649.00` reads as 1,649.00 and `Eggs 10 250.00` as 10,250.00, because space grouping is allowed in every region. [amounts.ts:17]

### Medium
- [x] **P4 Common amount formats are dropped or wrong (run).** `RM12.50`, `Rs450.00` and `12.50A` give no amount; `1’234.50` reads as 234.50. [amounts.ts]
- [x] **P5 A saved receipt offers `Reject · Not mine` and refuses Delete.** Any non-manual source counts as captured, and `DeleteEntry` returns `USE_REJECT`; 10.4 requires Delete. [editCommands.ts:216, TransactionDetailScreen.tsx:331, ReviewQueueScreen.tsx:242]
- [x] **P6 `Paid with` cannot be changed to the only account.** The picker opens only with more than one account, so with one non-cash account and no shop history Save creates a Cash account instead. With several accounts, Cash cannot be picked again. [ReceiptReviewScreen.tsx]
- [x] **P7 The review lists every category as a quick chip.** `ctx.quick` is the full ranked list, so `More` only adds Uncategorised. [receiptApi.ts:528]
- [x] **P8 A category picked from `More` disappears on the Add sheet.** The list closes to the first four tiles, so no tile shows the choice; edit mode has the same blank. [AddSheet.tsx:587]
- [x] **P9 The review says `No photo` only when there is a photo.** The placeholder is now conditional on `photo` but keeps its text and label. The thumbnail and viewer remain deferred. [ReceiptReviewScreen.tsx]
- [x] **P10 Category tiles are forced dark in light theme (reviewer).** Light-theme icon colours on dark tiles fall under 3:1 contrast, down to 1.4:1; the review screen shows dark tiles on a light page. [AddParts.tsx:61]
- [x] **P11 Touch targets are under 48dp.** Snap 36, Clear 40 with slop, review rows 44, item row 36, item category 32 with overlapping slop. [AddSheet.tsx:721, Keypad.tsx, ReceiptReviewScreen.tsx:604-610]
- [x] **P12 TalkBack does not read values.** Merchant, subtotal, tax, fee and discount rows are labelled only `Edit {field}`; category totals and the date are not spoken as specified; the uncategorised item pill's label differs from its text. [ReceiptReviewScreen.tsx]
- [x] **P13 A new read revives a cancelled one.** One shared flag is reset before the new job is queued, so the old scan runs on and eats the new one's 20 s timeout. [OcrModule.kt:29]
- [x] **P14 Every engine failure says reading does not work on this phone, with no retry.** Out of memory, a bad image and inference errors all become unavailable. [OcrModule.kt:57-79, ocrEngine.ts]
- [x] **P15 All camera errors are swallowed.** A camera that fails to start shows a blank preview until the shutter is pressed. Ignore only the cancelled torch change. [VisionCameraSurface.tsx]
- [x] **P16 `igst`, `sgst` and the like match inside words (run).** `BigStack chips 3.50` is read as tax. [parseReceipt.ts TAX]
- [x] **P17 `Total paid` or `Total tendered` replaces the bill total (run).** [parseReceipt.ts TALLY]
- [x] **P18 A negative line after the subtotal is lost without a discount word (reviewer).** `Coupon -2.00` goes to unparsed and the items then exceed the total. [parseReceipt.ts]
- [x] **P19 A date in the future can be saved.** Neither the date editor nor `SaveReceipt` refuses it, so a misread year files the expense in a later period. [saveReceipt.ts]
- [x] **P20 Undoing a category merge leaves receipt lines on the target.** `MergeResult.previous` records splits only. [categoryArchive.ts:273,296]
- [x] **P21 Android Back does nothing while the review is loading or has failed.** The listener consumes Back before `discardRef` is set. [ReceiptReviewScreen.tsx:251-259]
- [x] **P22 Missing tests.** `realReceiptApi` against a database; choosing another account; hardware Back; the duplicate choices (the current test passes without them); a single split outside the main category; a discount between two items; receipt item icon and colour; picking from `More`; the item pill and thumbnail; torch off after capture; `UTGST` and `Cess`.

### Low
- [x] **P23 Delete is offered for a category held only by a receipt line, then refused.** [categoryArchive.ts previewCategory]
- [x] **P24 New Add and review controls have no focus ring.** [AddParts.tsx, AddSheet.tsx, ReceiptReviewScreen.tsx]
- [x] **P25 Hungarian `Összesen` never matches** (`\b` without the `u` flag). [parseReceipt.ts TOTAL]
- [x] **P26 A failed model download stays in the assets folder.** Write to a temporary file and rename after the hash check. [scripts/fetch-ocr-models.mjs]

## Deferred

Also listed in `deferred-work.md`.

- Zero-decimal currencies accept every integer as an amount (medium).
- No right-aligned number column detection, though 10.2 and S3 section 5 say there is (medium).
- The 90% merchant target cannot be met with non-Latin names; needs a product owner ruling (medium).
- S3 evidence for ML Kit is incomplete and GATE-05 is unsigned (medium).
- No open-source licence notices for the models and ONNX Runtime (medium, Epic 14).
- 16 KB page alignment of the ONNX Runtime libraries is unverified (medium if wrong; inspect the APK).
- `Clear` inside the amount's accessible group may be unreachable or cover long amounts (unverified; check with TalkBack and large text).
- No test of the real `WmbugoOcr` bridge payload (needs an instrumented test).
- The S2 schema document does not match `receipt_item`.
- The debug sample receipt route is still present and its gate is untested.

Already tracked, not added again: photo thumbnail and viewer, date picker and written date formats, merchant re-derivation, discount under a rejected item, rotated text, scan speed and memory, `abiFilters`, Attach overwriting splits.

## Rejected

| Finding | Reason |
|---|---|
| Items cannot be edited, added or removed | False at HEAD: Story 10.5 added the item editor |
| Today's receipts ignore the printed time | False: the acceptance criterion says now when the date is today |
| `createCash` can make a second Cash account | False from the app: the default is null only when no Cash account exists |
| Review intro claims a photo when there is none | Low: only the debug sample route has no photo |
| OCR session leak if the constructor throws; executor not shut down | Low: needs a corrupt bundled model or a dev reload |
| OCR box sort buckets | Low: the parser orders lines itself |
| Snap hint is spoken only | Low |
| Torch may not turn off before the camera closes | Unverified and low |
| Weak Kotlin test thresholds; receipt accuracy test scores three fields and has redundant assertions | Low |
| Discard during a save; failed Undo is silent | Low: narrow window, needs new handling |
| Mismatch warning hidden until the total is confirmed, and its wording for an oversize discount | Low: Save stays blocked and the item is editable |
| Missing total hint wording; typed time not editable; editing the subtotal changes nothing | Low |
| Unused copy; load failure uses the unreadable message | Low |
| Shop history limited to 300 rows; address without a digit can become the merchant; narrow fee words | Low |
| `Time 18.45` read as an item | Low: needs another mask rule, and the item can be removed |
| Not itemised flag or an invalid category on zero-amount lines | Low: not shown to be reachable |
| Debug sample route can show a blank screen | Low: debug only |
| S3 section 8 and an old deferred entry are out of date | Low: document edits only |

## Resolution (2026-11-25)

All 5 decisions and 26 patches are applied on `fix/epic-10-review`.

- Checks: core 1,444 tests, mobile 3,169 tests, both typechecks, eslint, gates 28/28, lockfile check, and the Kotlin OCR tests with the real models.
- Not verified: nothing ran on a phone, and the new CI steps have not run on GitHub.
- P22: `realReceiptApi` is tested against a stubbed database and writer, not a real database.
- P4: amounts with a currency mark are read for a fixed list of marks.
- D1: a receipt whose tax is exactly the amount of one unread item would be taken as tax-inclusive.
- D2: a total line with an unusual leading word is still the total when no plainer total or subtotal follows it.
