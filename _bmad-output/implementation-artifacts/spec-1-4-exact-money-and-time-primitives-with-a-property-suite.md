---
title: 'Story 1.4 - Exact money and time primitives with a property suite'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: 'd2e9611'
---

## Intent

Implements the epic's Story 1.4 acceptance criteria as written (see epics.md).

## Implementation Notes

- Core (`packages/core/src/shared`): Result, currency table (24 Phase 1 currencies), Money with BigInt-checked add/subtract, parseAmountInput, formatMinorPlain, Clock port + FakeClock, toLocalDate, captureNow, UUID v7 + monotonic generator, redacting Logger.
- Mobile (`apps/mobile/src/shared/formatAmount.ts`): Intl formatter on magnitude + direction; fraction digits substituted from exact minor units; SGD shows `S$`; never emits a minus.
- Lint: `Date.now`, `performance.now`, `new Date()` and `Date()` are banned in core non-test source; gate case added to `pnpm test:gates`.
- toLocalDate accepts instants from 1970 to year 9999 only, so the result is always a well-formed YYYY-MM-DD.
- Hermes risk: Intl.DateTimeFormat timeZone/formatToParts and NumberFormat must be re-run on a device (INTL suite per PRD); only Node ICU is exercised here.
- Logger redaction is deliberately broad (sensitive key names, amounts and 4+ digit runs inside strings).

## Review Triage Log

Inline self-review. Found and fixed: toLocalDate accepted out-of-range years (now INSTANT_INVALID). Lint caught irregular whitespace in a test; fixed. No other findings.
