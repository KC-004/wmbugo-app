---
title: 'Story 1.10 - App shell, navigation and feedback patterns'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: 'd97b6c0'
---

## Intent

Implements the epic's Story 1.10 acceptance criteria (see epics.md).

## Implementation Notes

- Shell (`features/shell`): React Navigation bottom tabs (custom `TabBar`) with a native stack per tab, Accounts and Settings above the tabs, no drawer. Below 600dp a glass bar (Home, Activity, ＋, Insights, Plan); from 600dp an 80dp solid rail with ＋ first. Slots at least 64 x 56dp, labels cap at 1.3x then auto-fit to 12sp, no badges, long-press shows the label. `AddButton`: 56dp, full 135 degree gradient, the only shadow, "Add entry". `ScreenHeader`: actions, Accounts, avatar; two rows from font scale 1.3.
- Feedback (`shared/feedback`): `SheetHost` (one at a time, replace not stack, glass body, grabber, scrim, solid footer, Back/scrim/swipe, focus back to the opener, safe-area aware), `ToastController` + `ToastHost` (one at a time, at least 10 s, system timeout honoured, pauses on touch or focus, persists under TalkBack, "Saved. Undo available"), `TooltipController` (one per session, never over a sheet, persisted through an injected `SeenStore`), `EmptyState`, `ErrorBlock`, `Skeleton`/`Reveal`.
- `shared/STATES.md` documents the PRD 6.4 state set.
- Tab navigation timing (NFR-03): `navTiming` records press to first frame and logs `nav.tab` durations (redacted logger).
- Jest now transforms the ESM navigation packages and uses one global safe-area mock.

## Verified on the Redmi (release build, shell temporarily forced visible)

- Tab navigation 74-92 ms for Activity, Insights, Plan (3 samples, release build). The S8 method wants 30 runs per pair; this is a first reading, not the benchmark.
- Glass sheet with grabber, title and a solid Cancel footer renders; the landscape rail (over 600dp) renders with the filled active icon.

## Not done / open

- Toast "Undo" uses on-glass ink; DESIGN.md asks for the teal accent on the toast. Cosmetic, needs a Button tone prop.
- Tooltip is not anchored to a control yet (a bubble component); anchoring comes with the first story that shows a tip (1.14 wires prompt_state).
- Focus return to the opener and focus trap are implemented but only unit-tested for the code path; real TalkBack behaviour needs a manual pass.
- 320dp x 200% header and 599/600dp are covered by layout tests, not on a device.
- The shell is unreachable on a fresh install until a profile exists (Story 1.11), so it was seen on the phone only through a temporary override.

## Review Triage Log

Inline self-review plus device check. Fixed: (1) high - the header, tab bar, rail and sheet footer ignored safe-area insets, so content drew under the status bar; found on the phone, now fixed with `useSafeAreaInsets`. (2) low - App tests assumed the old placeholder screen; updated. No other defects found.
