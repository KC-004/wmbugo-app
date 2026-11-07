---
title: PRD v1.3.6 reconciliation with UX spines
date: 2026-11-07
source: ../../ux-designs/ux-wmbugo-app-2026-11-07/EXPERIENCE.md › Deviations from PRD
---

# PRD v1.3.6 — reconciliation with UX "Deviations from PRD"

Each UX deviation row and the PRD / addendum locations rewritten for it. Changed FRs and rows carry `[v1.3.6]`.

| # | Deviation (UX spine) | PRD / addendum locations changed |
|---|---|---|
| 1 | Overspent hero: `Over budget ₹X`, unsigned, warning icon, days-only time line, no minus signs | §5.2 SCR-04; §6.3 hero item 2; §6.7 "Calm, not guilty" example + no-minus rule; TXN-006 (unsigned amounts); §8.8 HOM acceptance (new overspent case); §10 glossary "Budget remaining"; Appendix B "Overspent" row |
| 2 | Light-mode glass is deep-teal tinted (not translucent white 18%); dark-glass gradient cap | §6.2 "Visual system additions" (`glass.surface`), pointer to DESIGN.md › Colors › Glass; §6.6 Glass bullet |
| 3 | Primary buttons use the deep gradient segment; ＋ keeps the full gradient | §6.2 "Visual system additions" (`gradient.brand`); §6.6 Gradients bullet |
| 4 | Teal only in Phase 1; Theme = System/Light/Dark | §6.2 tokens note (Theme); SET-001 |
| 5 | Category colour only from 12 verified hues; seeds pre-assigned | §4.1 scope bullet; §5.2 SCR-18; §6.2 tokens note (no arbitrary colours, pointer to Category palette); CAT-002; §8.4 acceptance (new) |
| 6 | Addendum §4 N/W/S dark variants | addendum §4 final mark line (pointer to DESIGN.md › Colors › Needs / Wants / Savings) |
| 7 | Icon library, no emoji (👁 / ⚠ glyphs) | §6.2 new "Icons" paragraph (pointer to DESIGN.md › Brand & Style); §6.3 eye toggle; TXN-006 transfer/return icons; §8.8 HOM acceptance (eye toggle); Appendix B "Amounts hidden"; addendum §3 receipt review "date?" |
| 8 | BDG-008 gate fail: single next step `Not enough information yet · Set a limit →` | BDG-008; §8.5 acceptance (Free to use gate fail) |
| 9 | Evening summary `Today: N recorded · Tap to review` + expanded list | CAP-007 (evening notification wording); §8.16 CAP acceptance (evening summary); addendum §3 Evening summary |
| 10 | Restore copy: no lasting safety-copy promise (AD-10) | BKP-002; §8.14 BKP acceptance (new); FLOW-10 |
| 11 | FLOW-10 confirm = checkbox + re-auth, no typed `RESTORE` | FLOW-10; §8.14 BKP acceptance (new, shared with row 10) |
| 12 | SEC-005 hidden form `New payment to check` | SEC-005; §8.15 SEC acceptance (two cases) |
| 13 | Tablet two-pane deferred to Phase 2 | §4.2 Phase 2 list (new bullet); §5.3 Tablet rule |
| 14 | SCR-27 is a bottom sheet inside the dialog-styled activity | §4.1 scope bullet; §5.2 SCR-27; §6.6 Glass bullet; CAP-002; FLOW-09; §13.0 parity row; §21 WMB-16 |
| 15 | SCR-28 Learned merchants & blocked senders under Settings › Capture | §5.1 Header / Settings hub groups |
| 16 | TXN-006 day-header Spent is refund-net, floored at ₹0 | TXN-006; §5.2 SCR-07; §8.3 TXN acceptance (filter total amended; new worked example `Spent ₹201` / `Spent ₹0`) |

**Also updated:** front matter (1.3.6, 2026-11-07, final); Status and Version lines; §0 source legend (`[v1.3.6]`); §24 "Open UX items" replaced by a pointer to the UX spines and mockups, with GATE-06 evidence location; §24.1 change log row 1.3.6 and "Impact notes for v1.3.6"; §25 interaction-states item ticked with pointer.

**Judgement calls (resolved items marked):**
- **Resolved:** net refund surplus. Any net figure where refunds exceed spending is shown unsigned with "back" and the refund icon (`Shopping · ₹7,000 back`); in charts the bar sits at zero with a `₹7,000 back` label. No minus signs. Applied to §6.7, §8.5 acceptance (two cases), §8.9 acceptance (new), EXPERIENCE.md and DESIGN.md.
- FIN-010 account and GOAL-001 goal `icon/color`: **Resolved** — accounts and goals pick from the same 12-hue palette (account-type defaults in UX DESIGN.md › Category palette).
- **Resolved:** addendum §1 open question 2 ("Floating capture dialog") marked resolved with a pointer to EXPERIENCE.md (capture sheet = bottom sheet in the dialog-styled activity).
- **Resolved:** BDG-008 gate fail. The single next step names the missing required input: `Not enough information yet · Set a limit →` (no budget and no 50/30/20) or `Not enough information yet · Add an account →` (limit exists, no included account). Bills and goals are optional and never gate. Applied to BDG-008, §8.5 acceptance, EXPERIENCE.md.
