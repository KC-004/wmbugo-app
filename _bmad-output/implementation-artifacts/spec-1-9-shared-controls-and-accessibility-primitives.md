---
title: 'Story 1.9 - Shared controls and accessibility primitives'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: 'e7ba8b9'
---

## Intent

Implements the epic's Story 1.9 acceptance criteria (see epics.md).

## Implementation Notes

- `shared/ui`: `Amount` (the only money renderer), `Button` (primary with the deep brand gradient, secondary, secondary-on-footer, text; disabled stays focusable with the reason as a hint), `Chip` (32dp visual, 48dp hit area, five variants, filled icon when selected), `FocusRing` / `useFocusRing` (2dp ring, 2dp offset, on-glass colour).
- `shared/a11y`: amount label builder (exact EXPERIENCE.md strings), `aboutText` for `~`, `controlA11y` (role, state, hint), `LiveRegion` / `announce`, `useReducedMotion` (animator scale 0, system flag, in-app setting).
- Lint: feature code (`src/features/**`) may not import the formatter, call `Intl.NumberFormat`, `toFixed` or `toLocaleString`; a gate case proves it.
- Copy catalogue: keys in `shared/copy.ts` plus a test that checks every entry for sentence case and banned wording (inbox, coming soon, exclamation marks, guilt words).
- Hidden amounts: symbol plus four dots; the `+` sign stays (DESIGN.md says signs stay).
- Interpretation: "role and state in its TalkBack label" is done with `accessibilityRole` plus `accessibilityState` (TalkBack then reads "Food, button, selected"). Writing the state into the label text as well would make TalkBack say it twice.

## Not done / open

- The `320dp x 200%` check for the 9-digit INR amount is verified structurally (one line, auto-fit floor, clip, no mid-number wrap) but not at 200% font scale on a device: this phone blocks system settings changes over adb. Do it by hand in Settings > Display > Font size, or in the Story 1.10 shell.
- Greyscale check is by component cues (selected state, icon weight, border) and a luminance comparison, not a pixel snapshot.
- Focus ring on real D-pad or keyboard focus is unit-tested (focus/blur events), not exercised with a hardware keyboard.

## Review Triage Log

Inline self-review. Found and fixed during the work:
1. high - the selected chip used the dark canvas ink in light mode (about 3:1 on the accent fill); DESIGN.md says white in light, dark ink in dark. Fixed and tested.
2. medium - `spokenAmount` stripped any trailing `,000` (so 1,000 IDR or 1,000 rupees would be read as "1"). Now strips only the currency's exact minor digits; tested.
3. low - the hit-rect audit counted composite and host nodes twice; now host nodes only, and a deliberately small control proves it fails.
