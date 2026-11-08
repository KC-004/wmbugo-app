---
title: 'Story 1.5 - Spike S2: Initial schema and migration plan'
type: 'chore'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '2b00133'
---

## Intent

Implements the epic's Story 1.5 acceptance criteria (see epics.md).

## Implementation Notes

- Decision record: `docs/decisions/S2-initial-schema.md` (conventions, ownership, migration plan, all Epic 1 tables in full, later-epic tables as column lists, worked sign examples).
- Schema lint: `packages/core/src/schema-lint.ts` (+ test). Works on Drizzle source text, so core stays free of Drizzle. Convention: Drizzle schema files are named `*.schema.ts` under `apps/mobile/src`. Self-check cases prove bad schemas fail.
- Open: GATE-07 finance review is not signed, so the "product owner's review is recorded" criterion is unmet. Recorded as pending in the record.
- Deviation: the AC says every primary key is a UUID v7; keyed lookup tables (settings, prompt_state, schema_migration, sms_cursor, balance_chain, budget_alert_fired) are an explicit allowlist.
- Open point for the reviewer: keep `account.opening_minor` or derive it only from the opening posting.

## Review Triage Log

Inline self-review. No defects found in the lint logic after tests; the one design risk (opening_minor duplicating the opening posting) is noted in the record for GATE-07.
