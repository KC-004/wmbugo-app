# Implementation readiness gate — wmbugo app (2026-11-08)

**Verdict: CONCERNS.** The plan can be built, and Story 1.1 can start now. There is one real cross-artifact conflict (AD-10 vs PRD SEC-001 and the stories, on how `sms_cursor` is handled at restore). Two places force a developer to make an architecture decision nothing records: the AD-3 read graph, and the low-space restore path. There is also a backlog of story-introduced catalogue and ownership entries to sync back into the spine. None of this blocks Epic 1. Each item must be fixed before the epic that hits it starts (Epics 3/7, 8, 13).

Inputs: PRD v1.3.6 + addendum; ARCHITECTURE-SPINE (AD-17 corrected); UX DESIGN.md / EXPERIENCE.md; epics.md (14 epics, 146 stories); epics-validation-report.md. The coverage, story-quality, forward-dependency and table-timing checks are trusted. Spot-checked stories: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.11–1.16, 3.1, 3.2, 3.3, 3.10–3.13, 4.4, 6.1, 7.1, 7.6, 8.8, 8.9, 11.1–11.4, 11.8–11.10, 11.14, 11.15, 13.1, 13.8, 13.9.

## Findings (by severity)

### F1 — MEDIUM — Conflict: `sms_cursor` at restore (AD-10 vs PRD SEC-001 / Stories 8.8, 13.8, 13.9)
- AD-10 lists `sms_cursor` as **derived state that is rebuilt** after restore.
- PRD SEC-001 says "the restored cursor is **kept**". Stories 8.8, 13.8 and 13.9 carry it as data and resume from it.
- The stories follow the PRD, so the spine is wrong.
- Story 13.9 also adds an unrecorded rule: resume from the restored cursor only if it is ≤ 30 days old, otherwise from consent. The PRD does not state this.
- **Fix:** amend AD-10 to remove `sms_cursor` from derived state. Record the ≤ 30-day rule in PRD SEC-001, or drop it from 13.9. **Owner:** bmad-architecture (AD-10) + bmad-prd (SEC-001 note), or bmad-correct-course.

### F2 — MEDIUM — Unrecorded decision: low-space restore without a safety copy (AD-10 vs Stories 8.8 / 8.9)
- PRD BKP-002 allows a restore without the snapshot after explicit confirmation.
- AD-10 records only the safety-copy path.
- Story 8.8 adds `withoutSafetyCopy` / `LOW_SPACE_NEEDS_CONFIRMATION`, but nothing says how a post-swap start-check failure is recovered when no copy exists.
- Story 8.9 still shows "If something goes wrong during restore, nothing on this phone changes." in that mode. That promise is false there, and the UX Voice table bans copy the architecture doesn't keep.
- Story 8.8 also decides that device-local settings (`app_lock_enabled`, Lock after, `hide_in_recents`) survive restore. This is a sensible gap-fill but is not recorded.
- **Fix:** AD-10 records the no-copy path and its failure behaviour, plus the device-local settings rule. 8.9 replaces the reassurance line in low-space mode. **Owner:** bmad-architecture + story edit (bmad-correct-course).

### F3 — MEDIUM — Unrecorded decision: cross-module reads for merchant names, source kinds and Activity / search (AD-3)
- The AD-3 graph gives `insights` reads from ledger, planning and profile only. Story 7.1 enforces this with an architecture test ("no capture import").
- But Story 7.1's `InsightsScope` has a `sources` filter (capture `source_record`).
- Story 7.6 shows "the user's display name for the merchant". After `RenameMerchant` (11.2) that name lives in learning's `merchant` table.
- Story 3.6 builds an FTS5 index over merchant, original description, note, category name and account name. That spans ledger and capture, and no owner is named.
- AD-3 also says nothing about which module owns the Activity list query (ledger rows + capture status/source + learning merchant name).
- A developer would have to choose one of these: denormalize `source_kind` / merchant display name onto `transaction`, add insights → learning/capture edges, or move these queries into use cases.
- **Fix:** add the decision to AD-3: owner of the Activity/search query, owner of the FTS table, and how merchant names and source kinds are read. Do this before Epic 3 (3.6) and Epic 7. **Owner:** bmad-architecture.

### F4 — LOW — Story-introduced catalogue, port and table entries not yet in the spine
- **Events:** `AccountsChanged`, `CategoriesChanged`, `BudgetsChanged`, `GoalsChanged`, `RecurringChanged`, `ReceiptItemCategorised`.
- **Ports:** `CategorySuggester`, `Crypto`, `CsvTokenizer`. `SmsInbox`, `Scheduler`, `WidgetSnapshot` and `OcrEngine` are already in the seed.
- **Tables:** `recurring_payment`, `budget_target_version`, `csv_format`, the FTS5 index.
- All of these follow the spine's rules:
  - Each story names its event, its areas and the module that owns the new table.
  - `CategorySuggester` runs capture → learning, an allowed direction.
  - Story 1.7 makes the code catalogue type-checked, so the stories plus code are an adequate record for building.
- Story 6.1 explicitly says "the AD-3 ownership table lists `recurring_payment`", but the spine does not yet. Stories 11.1 and 11.14 also write their decisions into AD-12.
- **Fix:** one spine sync pass. It is not blocking for Story 1.1. Do it before Epic 4. **Owner:** bmad-architecture.

### F5 — LOW — Widget stale after a budget change
- The widget headline follows the hero ("₹11,860 left").
- `BudgetsChanged` (4.6) invalidates budgets, Home and Plan, but not `widget`.
- Story 11.15's widget trigger list leaves out `BudgetsChanged` and `AccountsChanged`.
- **Fix:** add the `widget` area to `BudgetsChanged` (and to `AccountsChanged` if In-accounts ever shows). **Owner:** story edit in 4.6 / 11.15.

### F6 — LOW — Interim deviation from AD-6 in Epic 1
- Stories 1.13 and 1.15 save through `RecordManualEntry`, outside `SubmitCapture`. Story 3.2 retires it.
- This is recorded in the stories but not in AD-6 / LIR-06.
- **Fix:** accept it as a sequencing exception (note in the sprint plan). Or have 1.13 introduce a minimal `SubmitCapture`. **Owner:** sprint planning note.

### F7 — LOW — Spine hygiene
- The frontmatter still says `updated: 2026-11-07` and sources PRD v1.3.5.
- The Open Questions bullet still reads "exclusion of SMS/UPI modules from the `nosms` bundle". After the AD-17 correction it should say SMS only.
- **Fix:** edit the spine. **Owner:** bmad-architecture.

## AD reliance (stories → ADs)
- AD-1/2/3: 1.1, 1.5, 7.1, all modules.
- AD-4: 1.7, all use cases.
- AD-5: 1.4, 1.12, 2.x.
- AD-6: 3.1, 3.2, 4.4, 11.x, 12.x, 13.x.
- AD-7: 1.14, 4.5, 4.8, 7.1.
- AD-8: 1.2, 1.5, 1.6.
- AD-9: 1.1, 1.6, 3.11, 8.6.
- AD-10: 8.8, 13.9.
- AD-11: 13.8.
- AD-12: 11.1, 11.4, 11.14, 11.15, 12.5.
- AD-13: 8.5, 11.6, 11.12.
- AD-14: 10.1.
- AD-15: 1.7, 5.1.
- AD-16: 1.4, 3.12, 11.10.
- AD-17: 1.1, 12.3, 13.1, 13.12.
- AD-18: 1.1, 1.3, 1.4, 14.x.
- AD-19: 1.4, 8.1, 8.12.

AD-17 (UPI ships in both flavors) is applied consistently in 12.3, 12.6 and 13.1. The PRD v1.3.6 deviation rows (overspent hero, evening summary, BDG-008 gate, restore checkbox, SEC-005 hidden form, theme, no emoji, no two-pane) are all applied in the stories. No other story contradicts a recorded decision.

## Before Story 1.1
Nothing blocks it.
- S1 (1.2), S8 (1.3) and S2 (1.5) are sequenced right after 1.1. S1 may force the AD-2 fallback and some 1.1 layout rework, which is an accepted risk.
- S3–S7 gate only Epics 10, 11 and 13.
- GATE-01 (scope sign-off) is evidenced only in 14.10. The PRD freeze at v1.3.6 serves as the de-facto sign-off. Optionally record it now.

## Orphans
- **PRD → stories:** no P1 orphans found (coverage trusted, P1 scope bullets spot-checked).
- **Stories → intent:** the unrecorded rules in F1 (≤ 30-day cursor) and F2 (device-local settings kept on restore) are the only story-made rules found without a recorded source. Everything else spot-checked traces to the PRD, ADs or UX.
