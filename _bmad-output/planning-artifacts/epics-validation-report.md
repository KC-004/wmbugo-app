---
title: Epics validation report
target: _bmad-output/planning-artifacts/epics.md
validator: step-04-final-validation (bmad-create-epics-and-stories)
date: 2026-11-08
result: all checks pass; all open items resolved (user-approved fixes, 2026-11-08)
---

# Epics validation report: wmbugo-app

Scope: `epics.md` (14 epics, 146 stories, 7,233 lines), checked against `steps/step-04-final-validation.md`, `templates/epics-template.md` and `ARCHITECTURE-SPINE.md`. The checks used a Python parser that reads the Requirements Inventory, the FR Coverage Map, the Epic List and every story's statement, Given/When/Then blocks and `**Covers:**` line. Judgment was used for AC quality, dependencies and epic structure.

## Summary

| # | Check | Result |
|---|-------|--------|
| 1 | FR / NFR / RB / GATE / UX-DR coverage | PASS |
| 2 | Architecture: starter story and table creation timing | PASS (OPEN-1 and the `prompt_state` note resolved) |
| 3 | Story quality | PASS |
| 4 | Epic structure and file churn | PASS (churn is justified) |
| 5 | Dependencies | PASS (OPEN-2 resolved) |
| 6 | Consistency (mapping, frontmatter, placeholders, headings) | PASS after 16 mapping fixes (OPEN-3 resolved) |

No open items remain. The frontmatter stays `status: draft` until the user selects [C] Complete Workflow, as step 4 requires.

## 1. Coverage

- The Requirements Inventory has 371 IDs: 201 PRD FRs, 11 LIR, 20 NFR, 11 RB, 13 GATE and UX-DR1..115 with none missing.
- **Every non-Phase-2 FR/LIR appears in at least one story Covers line. So do every NFR, RB0-1..9, RB1-1..2, GATE-01..13 except GATE-11, and UX-DR1..115.** Nothing is uncovered, and no Covers line cites an ID that is missing from the inventory.
- Phase 2 IDs (REC-005, INS-017..019, INS-021..024, IMP-008, GATE-11) are not claimed by any story. REC-007, CAT-005 and BDG-005 are cited only for their P1 parts (manual kind, override, no rollover), which is correct.
- **Spot-check that the ACs implement the FR and do not just name it (15 FRs). All 15 pass:**

| FR | Story | AC evidence |
|----|-------|-------------|
| FIN-014 | 3.12, 3.13 | Recently deleted list with "23 days left"; salted-hash tombstone with no amount or merchant; transfer purges both legs |
| FIN-026 | 11.10 | `guardedNow` handles the 30-day reboot trust window, the now + 1 day cap and `CLOCK_UNTRUSTED`; loosening applies now and tightening applies tomorrow (11.11) |
| FIN-027 | 3.1 | 10-minute manual window; CSV same-file exclusion with an occurrence index; edge days go to `held_pair` |
| TXN-012 | 3.2, 3.3 | Saved as `needs_review` with an open `review_candidate`, uncounted, never auto-approvable |
| TXN-013 | 3.10 | `USD 12.99` with a keypad labelled "Amount charged in ₹"; Confirm stays disabled; no exchange rate |
| BDG-006 | 4.5 | Shopping floored at ₹0; `Refunds this period: +₹7,000`; Left in budget does not go up |
| BDG-008 | 6.9 | "Short by ₹5,000" shown neutral, with no minus sign; the gate names one next step |
| ACC-003 / ACC-007 | 2.6, 2.7 | "You owe" with the caption "From your entries"; Pay card bill opens a prefilled transfer |
| REC-004 / REC-009 | 6.3 | Linked exactly once, re-linking refused, the link survives an amount edit |
| GOAL-002 / GOAL-004 | 6.6, 6.7, 6.9 | "Set aside" and "Moved" are kept apart; over-allocation shows "This leaves you short" |
| INS-005 | 7.1 | Like-for-like intervals and the formula are in core |
| IMP-005 | 9.4, 9.7 | `paused` at `committed_through_row = 1000`, resume, invariants pass |
| BKP-002 | 8.8 | `quick_check`, invariants and balances checked against the manifest; `BACKUP_DAMAGED` leaves the data untouched |
| SEC-005 | 8.5 | Hidden form "New payment to check" with no amount; Review goes through LockGate |
| SMS-010 / UPI-006 | 13.3, 12.5 | DLT sender decision table; `pending_share` is committed before LockGate and survives a kill |

## 2. Architecture

- **Starter story:** Story 1.1 is the starter scaffold. It sets up the RN CLI 0.88.x template with New Architecture and Hermes, TS strict, a pnpm workspace with `node-linker=hoisted`, `packages/core` and `apps/mobile`, the folder skeleton, both flavors, CI and the permission allowlist. This matches AD-2, AD-3, AD-17 and AD-18. PASS.
- **Tables:** Story 1.5 (Spike S2) assigns each Epic 1 table to the first story that needs it. Every later table is created by a "this story's migration" AC in the first story that uses it:

| Story | Tables |
|-------|--------|
| 1.6 | `schema_migration` |
| 1.7 | `audit_event`, `outbox` |
| 1.11 | `profile`, `settings` |
| 1.12 | `account`, `transaction`, `posting` |
| 1.13 | `category`, `split` |
| 3.2 | `source_record`, `review_candidate` |
| 3.11 | `attachment` |
| 3.12 | `tombstone` |
| 4.5 | `budget`, `budget_period`, target versions |
| 4.9 | `budget_alert_fired` |
| 6.1 | `recurring_rule` |
| 6.6 | `goal`, `goal_allocation` |
| 9.2 | `csv_format` |
| 9.4 | `import_batch` |
| 10.4 | `receipt_item` |
| 11.2 | `learned_mapping` |
| 11.10 | `auto_approve_rule`, `clock_guard` |
| 12.3 | `pending_share` |
| 13.3 | `sender` |
| 13.4 | `balance_chain` |
| 13.8 | `sms_cursor` |

  Columns are added the same way: card details in 2.6, status and `capture_resolution` in 3.2, the foreign-currency fields in 3.10, `category_guessed` in 4.4, indexes in 5.1, settings keys in 5.3, 5.6 and 8.5, and reminders in 6.5. No story creates tables it does not use. No table is set up in bulk ahead of need.
- **OPEN-1 — RESOLVED (Stories 11.9, 12.2, 13.5).** Original finding: `account_identifier` (AD-3, ledger module; also in FIN-010) is used first in 11.9 (`account_identifier(sender ICICI, mask 7730)`), but no story's migration creates it. Add a creation AC to 11.9 (the first story that uses it), or to 1.12 if the masked-identifier field is wanted from the start.
- **Note — RESOLVED (Story 1.11).** Original finding: `prompt_state` is assigned to 1.11 in the 1.5 plan, and 1.11 writes to it. The 1.11 creation AC, however, names only `profile` and `settings` ("tables created by this story's migration"). 1.10 uses an injected store, so there is no gap in what can be built. Consider naming `prompt_state` in the 1.11 creation AC.

## 3. Story quality

- **All 146 stories have the full statement:** "As …" (written as a persona, e.g. "As Mei,"), "I want", "So that", plus a `**Acceptance Criteria:**` header, matched Given/When/Then counts, and exactly one `**Covers:**` line.
- Story numbering is contiguous in every epic.
- AC counts average 7.2 per story, with a minimum of 2 (11.14, a spike) and a maximum of 13. **No story has more than 25 ACs.**
- The largest stories still fit one dev agent: 10.4 and 12.4 (13 ACs each), and 5.2, 10.6 and 12.3 (12 ACs each). Each sits on core logic built in earlier stories. Watch 10.4 (receipt review and save) and 12.4 (UPI capture sheet) during sprint sizing.
- Spikes are written as time-boxed stories with decision-record ACs: 1.2, 1.3, 1.5, 10.1, 11.1, 11.14, 13.1 and 13.7. They block only the stories that depend on them.

## 4. Epic structure

- **User value:**
  - Epics 1 to 13 are each named after a user outcome.
  - Epic 1 holds 7 foundation stories (1.1 to 1.7) inside a user-value epic ending in "first expense in about 6 s". This is acceptable for a greenfield project and follows the architecture's critical path.
  - Epic 14 (Launch readiness) is mostly release-evidence work. It is justified by RB0/RB1 and the GATEs, and it carries SET-007 (Help) and SEC-009 as user-facing FRs.
- **File churn:** several shared surfaces are changed by many epics:

| Shared surface | Stories that change it |
|----------------|------------------------|
| Settings hub group rows | 1.16, 3.13, 5.3, 8.2, 8.3, 8.5, 8.10, 8.11, 9.x, 11.11, 13.9, 14.1 |
| Home card registry | 5.4, 6.10, 13.10 |
| Add sheet | 1.13, 1.15, 2.7, 10.7, 12.6 |
| Capture sheet | 11.4, 12.4, 13.6 |
| Activity row | 1.14, 3.5 |

  This is justified. Each surface is a designed extension point: group rows appear when their feature exists, and the card registry says "later stories add cards without changing Home". Each epic ships a usable increment that gives feedback, so merging epics is not recommended.
- **Independence:**
  - Epic 11 needs a capture source. It runs on the debug Capture lab fixtures and on Epics 9 and 10 (outside India), all of which come earlier, so it does not depend on a later epic.
  - Epics 12 and 13 build on Epic 11.

## 5. Dependencies

58 forward references were scanned (`Story X.Y` later in order, and `Epic N` with N greater than the current epic).

- **Classified OK (57):** forward notes, interim behaviour or extension points. Each story can be completed without the later one. Examples:
  - 1.10 → 1.13 / 1.14: sheet host, injected store
  - 2.3 → 2.6 / 2.7 / Epic 3: actions arrive later
  - 3.1 → 3.12: `previously_removed` union case
  - 3.2 → 3.3: interim `Saved · Undo` toast
  - 3.13 → Epic 8: re-auth guard is a no-op until then
  - 4.4 / 4.6 / 4.11 → Epics 5, 6, 11: ports and reuse
  - 5.3 / 5.5 → Epics 7, 8: shared hook and chart
  - 6.2 / 6.6 → 6.8: interim entry rows from SCR-14
  - 7.3 → Epic 9: CSV writer reuse
  - 8.x → Epics 11–14: slots and reserved flags
  - 9.3 → 9.6: progress callback
  - 10.4 → 10.6 / 10.8: debug fixture entry, interim toast
  - 10.9 → Epics 11, 12: shared entry point; OCR-013 is wired by 11.6, which cites it
  - 11.1 → 11.4: spike feeds the build
  - 11.5 / 11.6 → 11.6 / 11.11: deep link, lock-screen default hidden
  - 11.7 → 11.8: hand-over choice
  - 11.11 / 11.13 → Epic 13: release rows gated by `captureCapabilities`, empty Blocked-senders slot
  - 12.3 → 12.4: Story 11.4 layout until 12.4 lands
  - 13.8 → 13.9: debug lab until UI
  - 13.9 → 13.10: re-ask rules
- **OPEN-2 — RESOLVED (Story 2.1 → 2.2).** Original finding: 2.1's balance query sums "included asset accounts". Its AC refers to "the include/exclude flag added in Story 2.2, default included", so the query reads a column that 2.2 creates. Fix: move the flag column (default included) into 2.1's migration, or state that 2.1 treats every account as included until 2.2.

## 6. Consistency

- **Frontmatter** (`status: draft`, `stepsCompleted: [1, 2, 3]`, `inputDocuments`) is present. The extra key `storiesEpicsDone` does no harm.
- **No `{{` placeholders.** Headings follow the template: `## Epic N:` and `### Story N.M:`. The Epic List entries are `### Epic N:` under `## Epic List`, which is fine because the template leaves `{{epics_list}}` free-form.
- **Mapping mismatches fixed directly (16 line edits).** In each case a story in an earlier epic covers the ID before the epic the map named:
  - **UX-DR69:** the first just-in-time notification ask is Story 4.9 (Epic 4), not Epic 6. Fixed in the UX-DR map, in the Epic 4 notes (added) and in the Epic 6 notes (now "bill reminder ask"). UX-DR69 was also added to the Story 4.9 Covers line, which is traceability only.
  - **UX-DR39:** the bill-match prompt variant is built first in 6.3. The note was added to the UX-DR39–44 map line.
  - **FR map:**

| ID | Earlier coverage added to the map |
|----|-----------------------------------|
| ONB-006 | Epic 1, 1.16 |
| CAT-001 | Epic 1, 1.13 |
| CAT-006 | Epic 1, 1.13 |
| HOM-006 | Epic 1, 1.10 and 1.14 |
| SET-003 | Epic 6, 6.5 |
| SET-005 | Epic 5, 5.3 |
| SEC-002 | Epic 1, 1.1; also Epics 10, 13 and 14 |
| CAP-011 | Epic 6, 6.3 |
| UPI-005 | Epic 9, 9.3 |

  - **NFR / GATE map:** NFR-02 now also lists Epic 13 (S7). GATE-07 now also lists Epics 2–3 (2.1, 3.8).
  - After the fixes, the script finds no map entry whose earliest covering story sits in an epic the map leaves out.
- A UX-DR applied again in a later epic (for example DR68, DR71 or DR86 reused as a pattern) is not counted as a mismatch, because the map names the epic that introduces it.
- **OPEN-3 — RESOLVED (GATE-04 / Stories 1.2, 1.6, 8.6).** Original finding: GATE-04 (encrypted-DB library, key management, backup threat model) is cited only by 14.7. The work that produces its evidence is in 1.2, 1.6 and 8.6. Consider citing GATE-04 there for traceability. This is a story Covers decision, so it was left unchanged.

## Resolution of open items (user-approved, 2026-11-08)

1. **OPEN-1 — RESOLVED.**
   - **Story 11.9:** a new first AC, "this story's migration", creates `account_identifier(id, account_id, bank_key, sender_id?, mask, source, created_at)`, unique on (`bank_key`, `mask`). It stores masked digits only.
   - `sender_id` is nullable, because the `sender` table arrives later, in Story 13.3.
   - The AC also states that backup and restore carry the table, and that 12.2 and 13.5 reuse it.
   - FIN-010 was added to the 11.9 Covers line.
   - Stories 12.2 and 13.5 now say "(table from Story 11.9)" and do not create it again.
2. **OPEN-2 — RESOLVED.**
   - **Story 2.1:** a new migration AC adds `account.include_in_totals` (default true, meaning counted).
   - Its totals query and its `AccountsChanged` AC now read that column.
   - **Story 2.2:** keeps only the `Count in my totals` toggle and `SetAccountInclusion`, which saves `include_in_totals` (column from Story 2.1).
3. **OPEN-3 — RESOLVED.**
   - GATE-04 was added to the Covers lines of 1.2 (encrypted-DB library), 1.6 (key management) and 8.6 (backup format and threat model).
   - The GATE row of the coverage map now names Epics 1 and 8.
4. **Note — RESOLVED.** The 1.11 creation AC now names the `profile`, `settings` and `prompt_state` tables.

**Re-run of checks 2, 5 and 6 on the touched items:**

- **Check 2 (tables):** `account_identifier` is now created in 11.9, the first story that uses it. `prompt_state` and the `include_in_totals` column are each created in the first story that uses them. Covers lines are still complete, with nothing uncovered.
- **Check 5 (dependencies):** the new forward references are forward notes only: 2.1 → 2.2 (where the toggle lives) and 11.9 → 12.2 / 13.5 (reuse). Each story can be completed on its own.
- **Check 6 (consistency):** the map comparison is clean, there are no `{{` placeholders, and the headings are unchanged. All 146 stories still pass the format checks.
- No other story content was changed.
