---
title: 'Story 1.8 - Design tokens, theming and brand assets'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '4405f38'
---

## Intent

Implements the epic's Story 1.8 acceptance criteria (see epics.md) against DESIGN.md.

## Implementation Notes

- Tokens: `scripts/gen-design-tokens.mjs` generates `designTokens.generated.ts` (78 colours, spacing, radii) from DESIGN.md front matter. A test re-reads DESIGN.md and requires an exact match, so drift in either direction fails.
- Theme: `ThemeProvider` (System/Light/Dark; System follows the OS live; no accent option), `useTheme().color(name)`, type roles (11) with Inter 400/500/600 bundled in Android assets (OFL licence included) and tabular figures on money roles, motion 150-250 ms, one shadow token for the add button.
- Contrast: a WCAG helper; tests reproduce DESIGN.md's claimed ratios (17.06, 5.47, 7.58, 9.89, 8.23, ...) to within 0.02 and assert 4.5:1 text / 3:1 non-text. Dark glow alpha <= 45% and dark glass tint >= 62% are asserted.
- Glass: `Glass` plus `glassFallbackReasons` (API < 31, reported RAM < 3,500 MB, battery saver, animator scale 0, reduce transparency, over imagery) and a small Kotlin module `WmbugoDeviceCapabilities`. S8's "4 GB" is now "3,500 MB reported", because a phone sold as 4 GB reports about 3.7-3.9 GB.
- Icons and brand: Phosphor via the `Icon` wrapper; coin mark and paper boat as SVG; placeholder coin-flip Lottie (final asset is GATE-12) with the still pie face for reduced motion.
- Lint guards (each proven by a gate case): hex literals outside the theme module, emoji in strings, "Inbox", "coming soon", `ActivityIndicator`, numeric badge props, shadow/elevation properties, other icon sets and UI kits.
- Verified on the Redmi (temporary showcase, removed): Inter renders, dark theme follows the OS, native module reports API 33 / 5437 MB / saver off / animator 1, glass tint and border, outline and filled icons, coin mark, boat, Lottie.

## Not done / open

- **Backdrop blur**: no blur library is chosen (a native dependency decision). Glass draws the tint and border without blur. Needs a decision, ideally with the S8 glass performance measurement.
- **Trigger checks on a device**: battery saver and animator scale cannot be toggled over adb on this phone (settings writes are blocked), so those two triggers are covered by unit tests plus a live read of the real values, not by toggling.
- **Lottie** is the placeholder (GATE-12). **Reduce transparency** has no OS source; it arrives as the in-app setting in Story 1.16.
- "Dark glow alpha capped at 45%" is asserted on tokens; no glow is drawn yet.

## Review Triage Log

Inline self-review. Fixed: a Windows file-casing clash (Glass.tsx vs glass.ts, now glassRules.ts); `useGlassFallbackFor` was not a hook (removed); status bar background prop does not exist under edge-to-edge (removed). Lint caught irregular whitespace and a require() in tests earlier in the epic; none new here.
