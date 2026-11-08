---
title: 'Story 1.3 — Spike S8: Reference devices and benchmark method'
type: 'chore'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '9027063'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Performance and glass-fallback criteria across Epic 1 and later need agreed hardware, a measurement method and a glass threshold.

**Approach:** Write `docs/decisions/S8-reference-devices.md` listing devices, GATE-03 status, the NFR measurement method and the glass-fallback rule.

**Decisions (human, 2026-11-08):** devices are the Redmi Note 11 Pro+ 5G plus an Android 9 emulator as interim budget device; GATE-03 stays unsigned, so results are provisional.

</frozen-after-approval>

## Implementation Notes

- Documentation only; no code. The phone was read over adb (API 33, SM6375, 5.3 GB usable RAM, 60/120 Hz).
- Glass rule: API < 31 or RAM < 4 GB, plus a measured rule that Story 1.8 can first evaluate.
- Emulator timings are declared invalid; performance results are provisional until a real budget phone is named and GATE-03 is signed.

## Review Triage Log

Inline self-review, no subagents, no code in the diff. Only gap: sign-off absent, which the story's own fallback clause covers.
