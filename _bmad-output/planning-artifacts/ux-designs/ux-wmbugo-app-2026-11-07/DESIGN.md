---
name: wmbugo-app
description: Private, offline personal finance for one person on Android. Calm teal system, glass only on floating surfaces, numbers first. React Native CLI with no UI kit; this file is the visual contract.
status: final
created: 2026-11-07
updated: 2026-11-07
colors:
  # PRD §6.2 tokens, renamed to kebab-case (bg.canvas -> bg-canvas). Light value plain, dark value with -dark suffix.
  bg-canvas: '#F8FAFC'
  bg-canvas-dark: '#0F172A'
  bg-surface: '#FFFFFF'
  bg-surface-dark: '#1E293B'
  # Muted fill for disabled controls and the dark toast (not in PRD).
  bg-muted: '#E2E8F0'
  bg-muted-dark: '#334155'
  text-primary: '#0F172A'
  text-primary-dark: '#F8FAFC'
  text-secondary: '#475569'
  text-secondary-dark: '#CBD5E1'
  accent-primary: '#0F766E'
  accent-primary-dark: '#5EEAD4'
  semantic-income: '#15803D'
  semantic-income-dark: '#86EFAC'
  semantic-expense: '#B91C1C'
  semantic-expense-dark: '#FDA4AF'
  semantic-transfer: '#1D4ED8'
  semantic-transfer-dark: '#93C5FD'
  semantic-warning: '#B45309'
  semantic-warning-dark: '#FCD34D'
  semantic-info: '#6D28D9'
  semantic-info-dark: '#C4B5FD'
  # gradient.brand stops (PRD §6.2). Same in both modes.
  gradient-brand-start: '#2DD4BF'
  gradient-brand-mid: '#0F766E'
  gradient-brand-end: '#164E63'
  # Glass. Deep-teal tint #164E63 in both modes.
  glass-tint: '#164E63'
  glass-surface: '#164E63CC'        # light mode, 80% tint (decided; verified ratios in Colors > Glass)
  glass-surface-dark: '#164E639F'   # dark mode, 62% tint = LOCKED FLOOR (never lower)
  glass-border: '#5EEAD438'         # #5EEAD4 at 22%, 1px, both modes
  glass-border-dark: '#5EEAD438'
  glass-fallback: '#155665'         # light solid fallback (= 80% glass over #0F766E)
  glass-fallback-dark: '#1A3C4F'    # dark solid fallback
  # Dark-mode backdrop glows (and any gradient behind dark glass): gradient.brand stops at <=45% = LOCKED CAP.
  glow-start-dark: '#2DD4BF72'
  glow-mid-dark: '#0F766E72'
  glow-end-dark: '#164E6372'
  # Ink on glass (glass is deep teal in both modes, so on-glass ink is light in both modes).
  on-glass-primary: '#F8FAFC'
  on-glass-secondary: '#F8FAFC'     # light glass: hierarchy by type role, not colour
  on-glass-secondary-dark: '#CBD5E1'
  on-glass-accent: '#5EEAD4'        # light glass: icons/fills/indicators only, never text
  on-glass-warning: '#FCD34D'       # light glass: icons/overflow only, never text
  # Focus indicators (2dp ring, 2dp offset).
  focus-ring: '#0F766E'
  focus-ring-dark: '#5EEAD4'
  focus-ring-on-glass: '#F8FAFC'
  # Control boundaries (unselected chips, checkbox box, inputs).
  border-control: '#475569'
  border-control-dark: '#94A3B8'
  # 50/30/20 mark and Needs/Wants/Savings series (addendum §4).
  needs: '#0F766E'
  needs-dark: '#0D9488'
  wants: '#14B8A6'
  wants-dark: '#5EEAD4'
  savings: '#5EEAD4'
  savings-dark: '#CCFBF1'
  # Category palette: 12 categorical hues; the only colours a user can pick for a category.
  cat-rose: '#E11D48'
  cat-rose-dark: '#FB7185'
  cat-pink: '#DB2777'
  cat-pink-dark: '#F472B6'
  cat-fuchsia: '#C026D3'
  cat-fuchsia-dark: '#E879F9'
  cat-indigo: '#3730A3'
  cat-indigo-dark: '#818CF8'
  cat-sky: '#0284C7'
  cat-sky-dark: '#38BDF8'
  cat-cyan: '#155E75'
  cat-cyan-dark: '#67E8F9'
  cat-emerald: '#065F46'
  cat-emerald-dark: '#34D399'
  cat-lime: '#4D7C0F'
  cat-lime-dark: '#A3E635'
  cat-olive: '#6B6B1E'
  cat-olive-dark: '#C9C95A'
  cat-brown: '#8B5E3C'
  cat-brown-dark: '#D6A77A'
  cat-stone: '#78716C'
  cat-stone-dark: '#A8A29E'
  cat-slate: '#64748B'
  cat-slate-dark: '#94A3B8'
  # Utility, not in PRD.
  border-hairline: '#E2E8F0'
  border-hairline-dark: '#F8FAFC0F'
  scrim: '#0F172A99'
typography:
  # Inter, bundled (offline). Regular 400 / Medium 500 / SemiBold 600 only. Sizes in sp so 200% font scale works.
  # Every role that renders money uses tabular figures (font-feature 'tnum').
  display-amount:
    fontFamily: Inter
    fontSize: 40sp
    fontWeight: '600'
    lineHeight: 48sp
    letterSpacing: -0.5sp
    note: 'Hero headline amount. tnum. maxFontSizeMultiplier 1.5, then auto-fit to width (min 28sp); never ellipsized.'
  headline:
    fontFamily: Inter
    fontSize: 28sp
    fontWeight: '600'
    lineHeight: 34sp
    note: 'Screen figures (Free to use, account balance, capture amount). tnum. maxFontSizeMultiplier 1.5, then auto-fit (min 22sp).'
  title:
    fontFamily: Inter
    fontSize: 20sp
    fontWeight: '600'
    lineHeight: 26sp
  title-sm:
    fontFamily: Inter
    fontSize: 17sp
    fontWeight: '500'
    lineHeight: 24sp
  body:
    fontFamily: Inter
    fontSize: 16sp
    fontWeight: '400'
    lineHeight: 24sp
  body-medium:
    fontFamily: Inter
    fontSize: 16sp
    fontWeight: '500'
    lineHeight: 24sp
    note: 'Row titles (merchant). Row amounts use amount role.'
  amount:
    fontFamily: Inter
    fontSize: 16sp
    fontWeight: '600'
    lineHeight: 24sp
    note: 'Row and tile amounts. tnum. Scales fully; row stacks the amount on its own line instead of shrinking it.'
  keypad:
    fontFamily: Inter
    fontSize: 28sp
    fontWeight: '500'
    lineHeight: 34sp
    note: 'Keypad digits and entered amount. tnum. maxFontSizeMultiplier 1.5.'
  label:
    fontFamily: Inter
    fontSize: 14sp
    fontWeight: '500'
    lineHeight: 20sp
  caption:
    fontFamily: Inter
    fontSize: 13sp
    fontWeight: '400'
    lineHeight: 18sp
    note: 'Bar captions, daily-allowance line, In accounts / Card dues line, category grid labels. tnum.'
  tag:
    fontFamily: Inter
    fontSize: 12sp
    fontWeight: '500'
    lineHeight: 16sp
    note: 'Status tag pills on Activity rows. Floor size; never smaller.'
rounded:
  sm: 8dp
  md: 12dp
  lg: 16dp
  full: 9999dp
spacing:
  '1': 4dp
  '2': 8dp
  '3': 12dp
  '4': 16dp
  '5': 20dp
  '6': 24dp
  '8': 32dp
  '10': 40dp
  '12': 48dp
  gutter: 16dp
  margin-mobile: 16dp
  touch-min: 48dp
  content-max: 600dp
  rail-breakpoint: 600dp
  focus-ring-width: 2dp
  focus-ring-offset: 2dp
components:
  hero-card:
    background: '{colors.glass-surface}'
    background-dark: '{colors.glass-surface-dark}'
    border: '1px {colors.glass-border}'
    fallback: '{colors.glass-fallback}'
    fallback-dark: '{colors.glass-fallback-dark}'
    radius: '{rounded.lg}'
    padding: '{spacing.4}'
    label: '{typography.label}'
    amount: '{typography.display-amount}'
    ink: '{colors.on-glass-primary}'
    ink-secondary: '{colors.on-glass-secondary}'
    ink-secondary-dark: '{colors.on-glass-secondary-dark}'
    link-ink: '{colors.on-glass-primary}'
    focus: '{colors.focus-ring-on-glass}'
  hero-bar:
    height: 8dp
    track: '{colors.on-glass-primary} at 16%'
    fill: '{colors.on-glass-primary}'
    fill-dark: '{colors.on-glass-accent}'
    limit-tick: '2dp x 14dp {colors.on-glass-primary} core, 1dp {colors.bg-canvas-dark} outline, 1dp knockout gap each side'
    overflow: 'hatched 45deg, {colors.on-glass-warning} stripes 2dp on 4dp pitch over a {colors.glass-tint} base'
    overflow-max: '20% of track'
    radius: '{rounded.full}'
  limit-bar:
    height: 8dp
    track: '{colors.bg-muted}'
    track-dark: '{colors.bg-muted-dark}'
    fill: '{colors.accent-primary}'
    fill-dark: '{colors.accent-primary-dark}'
    limit-tick: '2dp x 14dp {colors.text-primary}'
    limit-tick-dark: '2dp x 14dp {colors.text-primary-dark}'
    overflow: 'hatched 45deg, {colors.semantic-warning} stripes'
    overflow-dark: 'hatched 45deg, {colors.semantic-warning-dark} stripes'
    overflow-max: '20% of track'
    status-text: '{typography.caption}'
    radius: '{rounded.full}'
  button-primary:
    background: 'linear {colors.gradient-brand-mid} -> {colors.gradient-brand-end}'
    foreground: '#FFFFFF'
    radius: '{rounded.md}'
    min-height: '{spacing.12}'
    type: '{typography.label}'
    focus: '{colors.focus-ring}'
    focus-dark: '{colors.focus-ring-dark}'
  button-primary-disabled:
    background: '{colors.bg-muted}'
    background-dark: '{colors.bg-muted-dark}'
    foreground: '{colors.text-secondary}'
    foreground-dark: '{colors.text-secondary-dark}'
    radius: '{rounded.md}'
    min-height: '{spacing.12}'
  button-secondary:
    background: transparent
    border: '1px {colors.accent-primary}'
    border-dark: '1px {colors.accent-primary-dark}'
    foreground: '{colors.accent-primary}'
    foreground-dark: '{colors.accent-primary-dark}'
    radius: '{rounded.md}'
    min-height: '{spacing.12}'
  button-secondary-on-footer:
    # Secondary button on a sheet's solid footer (glass-fallback). Accent outline on #155665 is only 1.50:1, so light mode uses on-glass ink.
    background: transparent
    border: '1px {colors.on-glass-primary}'
    border-dark: '1px {colors.accent-primary-dark}'
    foreground: '{colors.on-glass-primary}'
    foreground-dark: '{colors.accent-primary-dark}'
    contrast: 'light #F8FAFC on #155665 7.87:1; dark #5EEAD4 on #1A3C4F 7.87:1'
    radius: '{rounded.md}'
    min-height: '{spacing.12}'
  button-text:
    foreground: '{colors.accent-primary}'
    foreground-dark: '{colors.accent-primary-dark}'
    on-glass: '{colors.on-glass-primary}'
    min-height: '{spacing.12}'
    type: '{typography.label}'
  card:
    background: '{colors.bg-surface}'
    background-dark: '{colors.bg-surface-dark}'
    radius: '{rounded.md}'
    padding: '{spacing.4}'
  activity-row:
    background: '{colors.bg-surface}'
    background-dark: '{colors.bg-surface-dark}'
    min-height: 64dp
    padding-x: '{spacing.4}'
    title: '{typography.body-medium}'
    subtitle: '{typography.caption}'
    amount: '{typography.amount}'
    divider: '1px {colors.border-hairline}'
    selected-background: '{colors.accent-primary} at 12%'
    gap: '{spacing.3} between chip, text and amount'
    refund-icon: '16dp return icon, {colors.semantic-income}, immediately left of the + amount inside the amount column (4dp gap)'
    waiting-outline: '1px dashed {colors.border-control}, inset 4dp, 4dp corners'
  day-header:
    background: 'none (sits on {colors.bg-canvas})'
    min-height: 40dp
    padding: '{spacing.2} {spacing.4}'
    margin-top: '{spacing.1}'
    type: '{typography.label}, tnum'
    ink: '{colors.text-secondary}'
    ink-dark: '{colors.text-secondary-dark}'
    layout: 'date left, Spent right; stacked (date, then Spent, both left) at fontScale >= 1.3'
  category-icon-chip:
    size: 40dp
    radius: '{rounded.md}'
    background: 'category colour (cat-*) at 16% over the row surface'
    icon: '24dp, category colour, Phosphor outline'
    transfer: 'transfer icon in {colors.semantic-transfer} / {colors.semantic-transfer-dark} on a {colors.bg-canvas} / {colors.bg-canvas-dark} chip (as Other)'
  status-tag:
    radius: '{rounded.full}'
    padding: '2dp {spacing.2}'
    type: '{typography.tag}'
    background: '{colors.bg-canvas}'
    background-dark: '{colors.bg-canvas-dark}'
    border: '1px inset {colors.border-hairline}'
    border-dark: '1px inset {colors.border-hairline-dark}'
    foreground: '{colors.text-secondary}'
    foreground-dark: '{colors.text-secondary-dark}'
  chip:
    min-height: 32dp
    hit-area: '{spacing.touch-min}'
    radius: '{rounded.full}'
    padding-x: '{spacing.3}'
    type: '{typography.label}'
    border: '1px {colors.border-control}'
    border-dark: '1px {colors.border-control-dark}'
  chip-selected:
    background: '{colors.accent-primary}'
    background-dark: '{colors.accent-primary-dark}'
    foreground: '#FFFFFF'
    foreground-dark: '{colors.bg-canvas-dark}'
  checkbox-row:
    min-height: '{spacing.touch-min}'
    box: '24dp, 2px {colors.border-control} / {colors.border-control-dark}; checked fill {colors.accent-primary} / {colors.accent-primary-dark} + check icon'
    type: '{typography.body}'
  tab-bar:
    background: '{colors.glass-surface}'
    background-dark: '{colors.glass-surface-dark}'
    border-top: '1px {colors.glass-border}'
    icon-inactive: '{colors.on-glass-secondary} outline'
    icon-active: '{colors.on-glass-accent} filled'
    label-active: '{colors.on-glass-primary} Medium'
    pending-dot: '8dp {colors.on-glass-warning}, top-right of the icon'
    label-type: '12sp / 16sp, Regular inactive ({colors.on-glass-secondary}), Medium active'
    label-scale: 'maxFontSizeMultiplier 1.3, then auto-fit to the tab slot (min 12sp); single line, never ellipsized'
    slot: '64dp wide x 56dp min, icon 24dp, 2dp icon-label gap'
    min-height: 64dp
    bottom-inset: 'adds the gesture inset (16dp in mocks) below the 64dp row'
  nav-rail:
    background: '{colors.bg-surface}'
    background-dark: '{colors.bg-surface-dark}'
    width: 80dp
    icon-inactive: '{colors.text-secondary} outline'
    icon-active: '{colors.accent-primary} filled'
    icon-active-dark: '{colors.accent-primary-dark} filled'
  add-button:
    size: 56dp
    background: 'gradient.brand ({colors.gradient-brand-start} -> {colors.gradient-brand-mid} -> {colors.gradient-brand-end}), 135deg'
    icon: '28dp plus, #FFFFFF'
    radius: '{rounded.full}'
    border: '1px {colors.glass-border}'
    shadow: '0 4dp 12dp {colors.text-primary} at 30%'
  home-band:
    background: 'gradient.brand, 135deg, full strength (light mode only)'
    width: 'full bleed (edge to edge)'
    top: '4dp below the header row (12dp above the hero top edge)'
    height: 176dp
    radius-bottom: '{rounded.lg}'
    dark: 'no band; three radial glows {colors.glow-start-dark} at (18%, 16%) r 42%, {colors.glow-mid-dark} at (88%, 26%) r 46%, {colors.glow-end-dark} at (50%, 40%) r 55% of the screen'
  bottom-sheet:
    background: '{colors.glass-surface}'
    background-dark: '{colors.glass-surface-dark}'
    radius-top: '{rounded.lg}'
    grabber: '32dp x 4dp {colors.on-glass-secondary} at 60%'
    scrim: '{colors.scrim}'
    footer: 'sticky action footer, solid {colors.glass-fallback} / {colors.glass-fallback-dark}'
  capture-sheet:
    min-height: '60-70% of window; full height at fontScale >= 1.3'
    background: '{colors.glass-surface}'
    background-dark: '{colors.glass-surface-dark}'
    header: 'gradient.brand band (135deg, 132dp tall from the sheet top) behind grabber, amount, merchant, account line and pager; dark mode at <=45% (glow cap)'
    header-ink: '{colors.on-glass-primary} only for all text over the band, both modes (dark #CBD5E1 over the band is 3.96:1 = fail; #F8FAFC 5.61:1)'
    header-layout: 'amount (headline) / merchant (body-medium) / account + time (caption) left; Later top-right; min 112dp'
    radius-top: '{rounded.lg}'
    approve: '{components.button-primary}'
    reject: '{components.button-secondary-on-footer}'
    footer-layout: 'Reject and Approve equal width, {spacing.3} gap, padding {spacing.3} {spacing.4} plus bottom inset'
    pager: 'Previous (left) · N of M (label, centre) · Skip (right); text buttons 48dp, {colors.on-glass-primary}, underlined'
    page-dots: '6dp decorative, 6dp gap, centred under the pager, {spacing.3} below; active {colors.on-glass-accent}, inactive {colors.on-glass-secondary} at 40%'
    apply-to-all: 'button-text on glass, left-aligned, directly under the category grid and above the Remember row; only when cards share a merchant'
    auto-approve-line: '{typography.caption}, {colors.on-glass-secondary} / {colors.on-glass-secondary-dark}, under the Remember row'
  category-grid-cell:
    columns: '4, {spacing.2} gap'
    tile: 'full cell width x 48dp, {rounded.md}, {colors.on-glass-primary} at 12%'
    icon: '24dp {colors.on-glass-primary} outline'
    chevron: '12dp chevron-down, 2dp stroke, tile bottom-right 4dp inset (cells with subcategories)'
    label: '{typography.caption}, {colors.on-glass-primary}, centred, up to 2 lines (2-line height reserved), 4dp below tile'
    selected: 'tile {colors.on-glass-accent} with {colors.bg-canvas-dark} filled icon (12.07:1); label Medium'
    contrast: 'selected fill vs glass body >= 4.85:1 (dark) / 5.41:1 (light); no cat-* tint on glass'
  remember-toggle:
    pattern: 'checkbox-row on glass, full-row 48dp target, default checked'
    box: '24dp, 4dp corners; checked = {colors.on-glass-accent} fill + {colors.bg-canvas-dark} check (12.07:1); unchecked = 2px {colors.on-glass-primary} outline'
    label: '{typography.body}, {colors.on-glass-primary}'
  segmented-control:
    min-height: 40dp
    hit-area: '{spacing.touch-min}'
    track: '{colors.on-glass-primary} at 12%'
    radius: '{rounded.full}'
    selected-fill: '{colors.on-glass-accent}'
    selected-ink: '{colors.bg-canvas-dark}'
    ink: '{colors.on-glass-primary}'
    type: '{typography.label}'
  keypad-key:
    min-height: 56dp
    type: '{typography.keypad}'
    radius: '{rounded.md}'
    ink: '{colors.on-glass-primary}'
  toast:
    background: '{colors.text-primary}'
    background-dark: '{colors.bg-muted-dark}'
    border-dark: '1px {colors.glass-border-dark}'
    foreground: '{colors.text-primary-dark}'
    action: '{colors.accent-primary-dark}'
    radius: '{rounded.md}'
  tooltip:
    background: '{colors.text-primary}'
    background-dark: '{colors.text-primary-dark}'
    foreground: '{colors.text-primary-dark}'
    foreground-dark: '{colors.text-primary}'
    radius: '{rounded.sm}'
    pointer: '8dp triangle'
    max-width: 280dp
    type: '{typography.caption}'
    dismiss: 'Got it text button, 48dp'
  widget:
    background: '{colors.bg-surface}'
    background-dark: '{colors.bg-surface-dark}'
    radius: '{rounded.lg}'
    headline: '{typography.title-sm}'
    action-fill: '{colors.accent-primary}'
    action-fill-dark: '{colors.accent-primary-dark}'
  empty-state:
    illustration: 'paper boat, 96dp'
    text: '{typography.body}'
    text-color: '{colors.text-secondary}'
    text-color-dark: '{colors.text-secondary-dark}'
    action: '{components.button-primary}'
  setup-card:
    background: '{colors.bg-surface}'
    background-dark: '{colors.bg-surface-dark}'
    border: '1px dashed {colors.border-control}'
    border-dark: '1px dashed {colors.border-control-dark}'
    radius: '{rounded.md}'
    title: '{typography.title-sm}'
    action: '{components.button-text}'
  selection-bar:
    background: '{colors.bg-surface}'
    background-dark: '{colors.bg-surface-dark}'
    min-height: 56dp
    count: '{typography.title-sm}'
    action: '{components.button-primary}'
  stepper-header:
    text: '{typography.label}'
    progress: '{components.limit-bar} without tick'
  skeleton:
    fill: '{colors.border-hairline}'
    fill-dark: '{colors.border-hairline-dark}'
    radius: '{rounded.sm}'
---

# wmbugo — Design Spine

> Visual contract for the wmbugo Android app (Phase 1). Behaviour lives in [EXPERIENCE.md](EXPERIENCE.md). Decisions come from `.memlog.md` (canonical) and PRD v1.3.5 §6 (sources listed in EXPERIENCE.md). **This file and EXPERIENCE.md (the spines) win over any mock, wireframe or import when they conflict.**

Approved key-screen mocks (illustrations of this spine, linked inline where they apply): [mockups/key-home.html](mockups/key-home.html) (Home hero states, Home cards, glass tab bar), [mockups/key-activity.html](mockups/key-activity.html) (Activity rows, filter chips, day headers, 200% font scale at 320dp), [mockups/key-capture-batch.html](mockups/key-capture-batch.html) (capture sheet batch, dark and light).

## Brand & Style

wmbugo ("where my budget goes") is a private ledger that lives only on the phone. It answers "Am I okay?" at a glance and then gets out of the way. The posture is **calm, plain and exact**: big tabular numbers, few words, no pressure. The app never celebrates loudly and never scolds; an overspent month is a fact with a number, not a red alarm.

One brand family carries the identity: a teal gradient (`gradient.brand`), a coin mark (front: a **w** whose last stroke becomes an up-right arrow; back: a 50/30/20 pie in needs / wants / savings teals) and a paper-boat illustration on water. The coin flips on the splash and in long-task loaders. The boat appears only at rest or relief moments: empty states, "All checked", goal reached. It is never on the calm Home hero, which shows numbers only, and it is never the app icon.

Depth comes from **glass on floating surfaces only** (hero card, tab bar, Add sheet, capture sheet, small pills) over the brand gradient (light) or dim brand glows (dark). Everything that scrolls is solid.

Icons: one library with outline and filled weights (Phosphor). Outline by default; filled marks the active tab or selected state, so selection is a shape change, not just a colour change. **No emoji anywhere in the UI**; the PRD's eye and warning glyphs become library eye / eye-slash / warning icons.

## Colors

Token names are PRD §6.2 names in kebab-case (`bg.canvas` → `{colors.bg-canvas}`; dark values carry `-dark`). PRD §6.2 hex values are used exactly; additions are marked "(added)". **Accent themes are not in Phase 1**: teal only; tokens are named by role so accents can be added later. All ratios below are WCAG 2.x, computed by script (alpha-composited over the worst-case backdrop) on 2026-11-07.

| Token | Light | Dark | Use | Not used for |
|---|---|---|---|---|
| `bg-canvas` | #F8FAFC | #0F172A | App background | Cards |
| `bg-surface` | #FFFFFF | #1E293B | Cards, rows, widget, nav rail | Floating surfaces (those are glass) |
| `bg-muted` (added) | #E2E8F0 | #334155 | Disabled button fill; dark toast; limit-bar track | Text backgrounds for live content |
| `text-primary` | #0F172A (17.06:1 on canvas) | #F8FAFC | Values, titles, expense row amounts (unsigned) | — |
| `text-secondary` | #475569 (7.58:1 on surface) | #CBD5E1 (9.85:1 on surface) | Explanations, captions, greyed / rejected rows, not-itemised amounts | Warnings |
| `accent-primary` | #0F766E (5.47:1 on white) | #5EEAD4 (9.89:1 on surface) | Selection, primary actions, links | Decoration |
| `semantic-income` | #15803D (5.02:1 on white) | #86EFAC | "+" income and refund amounts | Positive "good" judgements |
| `semantic-expense` | #B91C1C (6.47:1 on white) | #FDA4AF (7.74:1 on surface) | Outflow series in charts and expense-vs-income comparisons (always with legend text) | Ordinary row amounts (unsigned, `text-primary`); overspend (a limit state → warning); anything that isn't a real problem (PRD §6.7) |
| `semantic-transfer` | #1D4ED8 | #93C5FD | Transfer icon tint | Transfer amount text (neutral) |
| `semantic-warning` | #B45309 (5.02:1 on white) | #FCD34D | Over budget, possible duplicate, limits, due soon (always with icon + text) | Not-itemised amounts (grey) |
| `semantic-info` | #6D28D9 | #C4B5FD | Recurring / informational markers | — |
| `focus-ring` (added) | #0F766E (5.47:1 on white, 5.23:1 on canvas) | #5EEAD4 (9.89:1 on surface, 12.07:1 on canvas) | 2dp focus ring, 2dp offset, on solid surfaces | — |
| `focus-ring-on-glass` (added) | #F8FAFC (≥5.08:1 on light glass) | #F8FAFC (≥7.09:1 on dark glass) | Focus ring on glass surfaces | — |
| `border-control` (added) | #475569 (7.58:1 on white) | #94A3B8 (5.71:1 on surface) | Unselected chip outline, checkbox box, input outline | Hairline dividers |

Every load-bearing text pair above meets 4.5:1 and every control boundary meets 3:1. Colour always travels with an icon, sign or word.

### Gradient

`gradient.brand` = `{colors.gradient-brand-start}` #2DD4BF → `{colors.gradient-brand-mid}` #0F766E → `{colors.gradient-brand-end}` #164E63. It is used on the splash, the logo tile, the light-mode Home backdrop band behind the hero (`{components.home-band}`), the ＋ button and the capture-sheet header band (132dp tall). The Home band is full bleed, starts 4dp below the header, is 176dp tall and has `{rounded.lg}` bottom corners. The lower part of the hero overhangs onto the canvas, which the 80% light glass passes. Text never sits on raw gradient; it sits on glass or a solid backing. See [mockups/key-home.html](mockups/key-home.html) (Home band, light frames) and [mockups/key-capture-batch.html](mockups/key-capture-batch.html) (header band).

- **Primary button** uses only the deep segment `{colors.gradient-brand-mid}` → `{colors.gradient-brand-end}`: white label 5.47:1 → 9.11:1.
- **＋ button** keeps the full 135° gradient: the white plus arms span gradient positions 0.36–0.64, where white is ≥3.90:1 (non-text ≥3:1 met).

### Glass (locked recipe)

Glass is a **deep-teal tint (`{colors.glass-tint}` #164E63) + backdrop blur + 1px `{colors.glass-border}` (#5EEAD4 at 22%)** in both modes.

| Mode | Tint | Worst backdrop → effective colour | `on-glass-primary` | Secondary ink | Accent / warning |
|---|---|---|---|---|---|
| Light | **80%** `{colors.glass-surface}` | white content (#FFFFFF) → #457182 | 5.08:1 (#FFFFFF 5.31:1) | #F8FAFC (same) | 3.59:1 / 3.68:1 — icons only |
| Light | 80% | gradient start #2DD4BF → #1B6975 | 6.05:1 | #F8FAFC | 4.28:1 / 4.39:1 — icons only |
| Dark | **62% floor** `{colors.glass-surface-dark}` | 45% glow over canvas → #185967 | 7.49:1 | #CBD5E1 5.28:1 | warning 5.44:1 |
| Dark | 62% | 45% glow over surface → #1C5D6A | 7.09:1 | #CBD5E1 5.00:1 | warning 5.15:1 |
| Dark | 62% | plain #1E293B → #194054 | 10.56:1 | #CBD5E1 7.44:1 | — |

- **Dark:** tint at **≥62% (locked floor)** over glows `{colors.glow-start-dark}` / `{colors.glow-mid-dark}` / `{colors.glow-end-dark}` at **≤45% (locked cap)**. **Any gradient behind dark glass obeys the cap**, Home or not (the capture-sheet header band included); at full strength the band drops primary ink to 4.42:1. The capture-sheet header band follows a stricter ink rule; see Capture sheet.
- **Light (overrides PRD "translucent white 18%"):** tint at **80%**. The PRD value fails (3.84:1 over #0F766E, 1.68:1 over #2DD4BF). The real worst case is white list content scrolling under the tab bar; 80% passes it. Full-strength gradient may sit behind light glass.
- **Ink on glass:** glass is dark in both modes, so on-glass ink is the light set. Secondary ink is #CBD5E1 in dark but #F8FAFC in light; in light, hierarchy comes from type role, not ink colour. On light glass, **`on-glass-accent` and `on-glass-warning` are never text**: links and labels use `{colors.on-glass-primary}` with an underline or `→` cue; accent is for icons, fills and indicators.
- **Over imagery:** glass over photo content (receipt images under the tab bar or a sheet) uses the solid fallback; 62% dark glass over a white photo gives only 3.22:1.
- **Fallback:** `{colors.glass-fallback}` #155665 (white 8.23:1) in light; `{colors.glass-fallback-dark}` #1A3C4F (#F8FAFC 11.13:1, #CBD5E1 7.84:1) in dark. Used when the device is below API 31 or the capability threshold, when battery saver is on, when animator scale is 0 or reduce transparency is on, and when glass sits over imagery. Same layout and hierarchy as glass.
- **Where:** hero card, tab bar, Add sheet, capture sheet, small pills. **Never** on lists, Activity rows, the widget, or behind small text that is not on-glass ink. A few glass surfaces per screen at most (NFR-19).

### Needs / Wants / Savings

| Series | Light | vs white | Dark | vs surface / canvas |
|---|---|---|---|---|
| `needs` | #0F766E | 5.47:1 | #0D9488 | 3.91 / 4.77:1 |
| `wants` | #14B8A6 | 2.49:1 | #5EEAD4 | 9.89 / 12.07:1 |
| `savings` | #5EEAD4 | 1.48:1 | #CCFBF1 | 12.98 / 15.84:1 |

The light values are the coin's pie face and stay. Light wants and savings are under 3:1, so every N/W/S mark on a light surface gets a 1px `{colors.text-secondary}` outline (7.58:1 on white), which carries the boundary. Adjacent series are low-contrast against each other in both modes (1.3–2.5:1), so charts use a 2dp `bg-surface` gap between segments, a direct label (name + value + %) on every segment (outside when too small) and a pattern per series in comparison charts (needs solid, wants dotted, savings hatched).

### Category palette

Twelve categorical hues; a user picks a category, account or goal colour only from these. Account defaults by type: cash `cat-lime`, bank `cat-indigo`, payment wallet `cat-sky`, savings pot `cat-emerald`, credit card `cat-fuchsia`; goals default to `cat-cyan`. Account and goal icons come from the same Phosphor set. Each passes ≥3:1 as non-text against `bg-canvas`, `bg-surface` and its own 16% chip tint, in both modes. Distinctness (CIEDE2000): every pair ≥11.5 in both modes; every hue ≥8.8 from the semantic income / expense / warning / info / transfer hues (lowest: emerald vs income) and ≥10.9 from the N/W/S teals. Category colour is never the only signal: the chip always carries the category icon and name.

| Token | Light | canvas / surface / tint | Dark | canvas / surface / tint | Seed default (CAT-001) |
|---|---|---|---|---|---|
| `cat-rose` | #E11D48 | 4.49 / 4.70 / 3.64 | #FB7185 | 6.63 / 5.44 / 4.29 | Food & Drinks |
| `cat-pink` | #DB2777 | 4.39 / 4.60 / 3.61 | #F472B6 | 6.74 / 5.52 / 4.32 | Shopping · Gifts |
| `cat-fuchsia` | #C026D3 | 4.50 / 4.71 / 3.70 | #E879F9 | 7.25 / 5.94 / 4.55 | Entertainment |
| `cat-indigo` | #3730A3 | 9.49 / 9.93 / 7.49 | #818CF8 | 5.98 / 4.90 / 3.82 | Education · Freelance |
| `cat-sky` | #0284C7 | 3.91 / 4.10 / 3.34 | #38BDF8 | 8.33 / 6.83 / 5.00 | Transport · Refunds |
| `cat-cyan` | #155E75 | 6.95 / 7.27 / 5.67 | #67E8F9 | 12.32 / 10.09 / 6.71 | Bills & Utilities · Interest |
| `cat-emerald` | #065F46 | 7.34 / 7.68 / 5.94 | #34D399 | 9.29 / 7.61 / 5.47 | Healthcare · Salary |
| `cat-lime` | #4D7C0F | 4.77 / 4.99 / 4.05 | #A3E635 | 11.84 / 9.70 / 6.60 | Groceries |
| `cat-olive` | #6B6B1E | 5.36 / 5.60 / 4.51 | #C9C95A | 10.19 / 8.35 / 5.87 | Travel |
| `cat-brown` | #8B5E3C | 5.33 / 5.58 / 4.49 | #D6A77A | 8.22 / 6.73 / 4.97 | Housing |
| `cat-stone` | #78716C | 4.59 / 4.80 / 3.93 | #A8A29E | 7.08 / 5.80 / 4.38 | Family · From people |
| `cat-slate` | #64748B | 4.55 / 4.76 / 3.90 | #94A3B8 | 6.96 / 5.71 / 4.31 | Personal Care |

**Other** is the neutral fallback, not in the picker: icon in `{colors.text-secondary}` on a `{colors.bg-canvas}` chip. Income categories reuse hues; their rows are already distinguished by `+` and income colour on the amount.

## Typography

**Inter**, bundled in the app (works offline), weights Regular 400, Medium 500, SemiBold 600 only. **Tabular figures (`tnum`) on every amount** so columns and changing values never jitter. All sizes are sp.

| Role | Size / line | Weight | Where |
|---|---|---|---|
| `display-amount` | 40 / 48 | 600 | Hero headline amount |
| `headline` | 28 / 34 | 600 | Free to use, account balance, capture amount |
| `title` | 20 / 26 | 600 | Screen titles, sheet titles |
| `title-sm` | 17 / 24 | 500 | Card titles, widget headline |
| `body` / `body-medium` | 16 / 24 | 400 / 500 | Copy / row titles |
| `amount` | 16 / 24 | 600 | Row and tile amounts |
| `keypad` | 28 / 34 | 500 | Keypad digits, entered amount |
| `label` | 14 / 20 | 500 | Buttons, chips, hero label |
| `caption` | 13 / 18 | 400 | Bar captions, daily line, accounts line, grid labels |
| `tag` | 12 / 16 | 500 | Status tag pills (floor size) |

Sentence case everywhere; no all-caps labels. Money formatting (symbol, grouping such as en-IN lakh, decimal comma, currency minor-unit digits of 0, 2 or 3) comes from the shared formatter, never from type styling.

**Large text (200% font scale).** An amount is never ellipsised, clipped or wrapped mid-number. Illustrated in [mockups/key-activity.html](mockups/key-activity.html) (right frame: 320dp × 200%, stacked amounts, two-row header, stacked day headers, scaled tab bar).

1. `display-amount`, `headline` and `keypad` cap at `maxFontSizeMultiplier` 1.5; `display-amount` and `headline` then auto-fit to the container width (`adjustsFontSizeToFit`, minimum 28sp / 22sp).
2. Activity row: at `fontScale ≥ 1.3`, or when the measured amount is wider than 40% of the row, the amount stacks on its own line under the title (right-aligned, tnum). The icon chip stays 40dp.
3. Hero **In accounts** and **Card dues** stack vertically at `fontScale ≥ 1.3`.
4. Every height that contains text is a **minimum**; containers grow.
5. **Tab bar:** labels cap at `maxFontSizeMultiplier` 1.3, then auto-fit to the 64dp slot (minimum 12sp); one line, never ellipsised or dropped; the bar grows in height, never in slot count. Long-pressing a tab shows its label in a tooltip at full scale; TalkBack labels are unaffected.
6. **Screen header:** splits into two rows at `fontScale ≥ 1.3` or whenever title plus actions do not fit one row; see Components › Screen header.
7. Activity **day header** stacks: date, then `Spent ₹X` on its own line, both left-aligned.
8. Test matrix: 320dp × 200% × en-IN 9-digit amount (`₹1,18,60,000`) × hidden and over-budget states.

## Layout & Spacing

4pt grid: `{spacing.1}` 4 · `{spacing.2}` 8 · `{spacing.3}` 12 · `{spacing.4}` 16 · `{spacing.5}` 20 · `{spacing.6}` 24 · `{spacing.8}` 32 · `{spacing.10}` 40 · `{spacing.12}` 48 (dp). Screen side margin `{spacing.margin-mobile}` 16dp; gutter `{spacing.gutter}` 16dp. Minimum touch target `{spacing.touch-min}` 48dp (a 32dp chip or 40dp segmented control carries a 48dp hit area). Paired values are vertical × horizontal.

Baseline is phone portrait 320–430dp, single column. At width ≥ `{spacing.rail-breakpoint}` (600dp) the bottom tab bar becomes a navigation rail and content is centred at a maximum width of `{spacing.content-max}` (600dp). Below 600dp, including phone landscape, the phone layout applies. Respect safe areas, cutouts, keyboard and gesture regions. Scroll views pad their end by tab bar + toast height so a focused row is never hidden under them.

Home vertical rhythm: header (64dp min: greeting in `title`, date in `caption` / `text-secondary`, Accounts and avatar 48dp icon buttons) → `{spacing.4}` → hero → `{spacing.4}` → cards with `{spacing.3}` between (see Components › Home cards). Activity: header (title + Search, `Select`, Accounts, avatar) → filter chip row (48dp) → day header + rows with no gap; hairline dividers. See [mockups/key-home.html](mockups/key-home.html) and [mockups/key-activity.html](mockups/key-activity.html).

## Elevation & Depth

Hierarchy is tonal, not shadowed:

1. `bg-canvas` (base) → 2. `bg-surface` cards (solid) → 3. glass floating surfaces → 4. scrim `{colors.scrim}` + sheets.

Shadows: none on cards. One soft shadow under the ＋ button only. Dark mode gets its depth from the capped brand glows behind glass. Never stack glass on glass; a sheet's sticky footer is solid fallback, not a second glass layer.

## Shapes

Radii stay within 8–16dp by hierarchy, plus `full` for pills:

- `{rounded.sm}` 8dp — tooltips, skeleton blocks, small inputs.
- `{rounded.md}` 12dp — cards, buttons, keypad keys, category icon chips, toasts, setup cards.
- `{rounded.lg}` 16dp — hero card, sheet top corners, widget.
- `{rounded.full}` — chips, status tags, segmented control, ＋ button, progress and limit bars.

## Components

Visual specs only; behaviour in EXPERIENCE.md › Component Patterns. Every focusable control draws `{colors.focus-ring}` / `{colors.focus-ring-dark}` (on glass: `{colors.focus-ring-on-glass}`) at `{spacing.focus-ring-width}` with `{spacing.focus-ring-offset}` when it has keyboard, D-pad or Switch Access focus.

### Buttons (`button-primary`, `button-primary-disabled`, `button-secondary`, `button-text`)

Min 48dp, `{rounded.md}`, `label`. Primary: deep-segment gradient, white label (≥5.47:1 on the gradient). Disabled: solid `bg-muted`, `text-secondary` ink (6.15:1 on #E2E8F0 light, 6.97:1 on #334155 dark), no gradient, outline icon. Secondary: 1px accent outline + accent label. **Secondary on a sheet's solid footer (`button-secondary-on-footer`):** the accent outline on the light footer `glass-fallback` #155665 is only **1.50:1** (fails 3:1), so in light mode the outline and label are `on-glass-primary` #F8FAFC (**7.87:1** on #155665, outline and text); in dark mode the accent stays (#5EEAD4 on #1A3C4F, **7.87:1**). Applies to the capture sheet's Reject and any secondary action in a sticky sheet footer. Text button: accent label (on glass: `on-glass-primary`, underlined).

### Chips (`chip`, `chip-selected`, `status-tag`)

Min 32dp tall, 48dp hit area, `{rounded.full}`, `label` type, 1px `border-control` outline when unselected (7.58:1 on white), 8dp between chips, 18dp icons. Variants: quick-category chip (icon + name), account chip, filter chip (removable: label + trailing close icon, drawn as `chip-selected` because it is an active filter; the whole chip is the tap target), `Filters · N` button chip (filter icon + count text, not a badge), `Clear all` chip, period / days-to-payday chip, Snap receipt / Share from UPI chips. Selected = `chip-selected` fill + filled icon. Status tags are smaller pills (`tag` type, 2dp × 8dp padding, `bg-canvas` fill with a 1px inset `border-hairline` ring) and are not buttons. See [mockups/key-activity.html](mockups/key-activity.html) (filter chip row, status tags).

### Checkbox row (`checkbox-row`)

Full-row 48dp+ target: 24dp box (`border-control` outline, checked = accent fill + check icon) + `body` label that wraps. Used for the restore confirmation and selection mode.

### Segmented control (`segmented-control`)

Min 40dp visual height, 48dp hit area, `{rounded.full}`, track `on-glass-primary` at 12%; selected segment filled `on-glass-accent` with `bg-canvas-dark` ink (12.07:1 on the accent fill) and Medium weight plus a filled check icon; unselected `on-glass-primary`.

### Screen header

At `fontScale ≥ 1.3`, or whenever title plus actions do not fit one row, the header splits into two rows: icon buttons (48dp) right-aligned on the first row, the title (`title`, wraps, never ellipsised) on its own row below. Text actions (Activity `Select`) move into a 48dp `More options` overflow icon button on the icon row; nothing is removed. See [mockups/key-activity.html](mockups/key-activity.html) (two-row header at 200%).

### Home hero card (`hero-card`, `hero-bar`)

Illustrated in [mockups/key-home.html](mockups/key-home.html) (under budget light and dark, over budget, amounts hidden).

Glass (`{components.hero-card}`), `{rounded.lg}`, padding `{spacing.4}`, on the darkest, most uniform part of the backdrop (light: over `{components.home-band}`). Anatomy top-down: label (`label`; over budget, a 20dp warning icon precedes it) · eye / eye-slash icon button top-right (48dp hit, icon aligned to the card's padding edge) · headline amount (`display-amount`, tnum, 12dp above the bar) · bar (`hero-bar`, 8dp) · caption `<spent> of <budget>` (8dp below the bar) · daily line · divider (1px `on-glass-primary` at 16%, 12dp above and below) · accounts line (`caption`): **In accounts** and **Card dues** side by side with 16dp between (stacked at `fontScale ≥ 1.3`), never summed; labels in secondary on-glass ink, values `on-glass-primary` SemiBold.

| State | Label | Amount | Bar | Lines |
|---|---|---|---|---|
| Under budget | Left in budget | `₹11,860` | Fill proportional to spent | `₹8,140 of ₹20,000` · `~₹988/day · 12 days left` |
| **Over budget** | warning icon (`on-glass-warning`) + **Over budget** | **unsigned** `₹2,340` (no minus) | Fill to the **limit tick**, then the **hatched overflow** segment, capped at `{components.hero-bar.overflow-max}` | `₹22,340 of ₹20,000` · days only: `5 days to payday` |
| 50/30/20 only, with unclassified spending | Left in budget | amount | as above | adds a 48dp row `includes ₹X not classified · Sort it` |
| No budget | Spent this period | spent amount | no bar | 48dp row `Set a limit →` in `on-glass-primary`, underlined |
| Accounts not set | (any of the above) | — | — | accounts line reads `Set up an account to calculate your balance` / `+1 account not set`; never a zero |
| Amounts hidden | label unchanged | mask `₹ ••••` (see Amount mask) | **bar hidden** (its fill would reveal the spent ratio); track space kept so layout does not shift | caption, daily line and accounts line keep their words with each figure masked (`₹ •••• of ₹ ••••`); eye-slash icon |
| Loading | skeleton blocks | — | — | real values fade in (150–250ms), no count-up |
| Fallback | same | same | same | `glass-fallback` surface, no blur |

**Bar contrast (verified):** track `on-glass-primary` at 16%; fill vs track ≥3.70:1 (light, over white-backed glass) and ≥3.43:1 (dark, over the brightest glow). Limit tick: `on-glass-primary` core with a 1dp `bg-canvas-dark` outline (17.06:1 vs light fill, 12.07:1 vs dark fill) and a 1dp knockout gap. Overflow: `on-glass-warning` stripes on a `glass-tint` base (stripes vs base 6.32:1); base vs fill 8.71:1 light / 6.16:1 dark.

The calm state shows numbers only: no phrase, no illustration.

### Tab bar (`tab-bar`, `add-button`)

Glass (`{components.tab-bar}`); outline → filled active icon in `on-glass-accent`; 12/16sp labels, Regular inactive in secondary on-glass ink, Medium active in `on-glass-primary`; pending dot 8dp `on-glass-warning` at the icon's top-right (≥3.68:1 on light glass); 64dp row plus the gesture inset; large text per Typography rule 5. ＋ button (`add-button`): 56dp gradient circle, centred in the tab bar, the one shadow in the app. See [mockups/key-home.html](mockups/key-home.html).

### Home cards (`card`)

Home cards are `card` with a `title-sm` title and an optional right-aligned `caption` scope (`This period`). The `N to check` card is a 48dp row (`title-sm` count, `caption` `Waiting for you`, trailing caret). See [mockups/key-home.html](mockups/key-home.html).

### Amount mask (hidden amounts)

When amounts are hidden, every amount everywhere renders as the **currency symbol + a fixed four dots** (`₹ ••••`, `S$ ••••`), in the same type role, weight and colour as the amount it replaces. The dot count never changes, so the mask never leaks magnitude (a ₹60 entry and a ₹1,18,60,000 balance look identical). Direction cues stay: income `+₹ ••••` in `semantic-income`, refund icon, transfer icon. Labels and tags remain. Bars and chart fills that encode a ratio of money (hero bar, limit bars, N/W/S bars) are hidden while masked; the track space is kept so layout does not shift. **Ratio text is hidden too:** any percentage or ratio derived from money (`85% used`, N/W/S `32%`, chart-table percent columns) is not rendered while masked (its line collapses), because it discloses what the hidden bar would. Text that is not money stays: counts (`3 to check`), days (`12 days left`, `Due in 2 days`) and labels; money inside status text is masked (`Over by ₹ ••••`). The dots glyph is hidden from accessibility; the node reads `Amount hidden`.

### Limit bar (`limit-bar`)

The solid-surface version of the hero bar, used for category budgets (SCR-14/15), Plan goals, 50/30/20 bars and bill "due soon" progress. Track `bg-muted`, fill `accent-primary`, `text-primary` tick at the limit, hatched `semantic-warning` overflow capped at 20%. Status text sits beside it whenever warning tint appears (`Over by ₹X` with warning icon, `80% used`, `Due in 2 days`). Home budget row layout: name (`label`) left, `₹3,400 of ₹4,000` (`caption`, `text-secondary`, tnum) right, 6dp above the bar; status text (`caption` with a 16dp icon, in `text-secondary`; in `semantic-warning` with the warning icon when over) 6dp below. While amounts are hidden the status percentage is not rendered (see Amount mask). See [mockups/key-home.html](mockups/key-home.html) (Budgets card).

### Activity row (`activity-row`)

Illustrated in [mockups/key-activity.html](mockups/key-activity.html) (every row state at 100% and 200%).

Solid surface, min height 64dp, padding 8dp × `{spacing.4}`, `{spacing.3}` between chip, text and amount. Leading `category-icon-chip` (40dp, `{rounded.md}`, `cat-*` hue at 16%, outline icon); title = merchant (`body-medium`); subtitle = `Category · Account` (`caption`, `text-secondary`) followed by status tag pills (wrap to further lines; 4dp × 6dp gaps); trailing amount column (`amount`, tnum, right-aligned, no wrap), reserved for amounts and their direction icon. Large text: the amount stacks on its own line under the title, right-aligned, and the row top-aligns its chip (see Typography rule 2). Selection mode: leading chip becomes a checkbox; selected rows get `selected-background`.

| Row state | Visual |
|---|---|
| Confirmed expense | Plain; amount unsigned (`₹420`) in `text-primary` |
| Income | `+₹85,000` in `semantic-income` |
| Refund | Leading chip = the Refunds category chip (return icon); amount column = 16dp return icon **immediately left of** the `+` amount, both `semantic-income`, 4dp gap (`↩ +₹1,299`). The icon stays with the amount when it stacks at large text and when masked (`↩ +₹ ••••`) |
| Transfer | Leading chip = transfer icon in `semantic-transfer` on a `bg-canvas` chip (no category hue); amount unsigned, `text-primary` |
| Guessed | `guessed` tag |
| Needs a category | `add category` tag |
| Waiting | `waiting` tag + dashed 1px `border-control` outline, inset 4dp, 4dp corners |
| Waiting for currency | `currency` tag + dashed outline; amount column shows the foreign amount (`USD 12.99`) |
| Possible duplicate | 16dp warning icon + `Check` tag, both `semantic-warning` (4.80:1 on the tag fill) |
| Reversed | `reversed` tag; title and amount struck through, `text-secondary` |
| Before tracking started | `before tracking` tag |
| Rejected | `rejected` tag; whole row `text-secondary`, only under Show rejected |

No minus signs anywhere. Sign, icon or tag text carries meaning; colour and styling reinforce it. A net figure where refunds exceed spending (Insights, category totals) is unsigned with `back` and the `refund-icon`: `Shopping · ₹7,000 back`.

### Activity day header (`day-header`)

Sits on `bg-canvas` between row groups (no surface, no divider), min 40dp, padding 8dp × `{spacing.4}`, 4dp above. `label` type in `text-secondary`, tnum. Left: `Today · Sat 7 Nov`, `Yesterday · Fri 6 Nov`, then `Thu 5 Nov` (older days show the date only, with no `Today` / `Yesterday` prefix). Right: `Spent ₹1,032`, the **refund-net** day total (defined in EXPERIENCE.md › Component Patterns › Activity row). Masked as `Spent ₹ ••••`. Large text: see Typography rule 7.

### Capture sheet (`capture-sheet`)

Illustrated in [mockups/key-capture-batch.html](mockups/key-capture-batch.html) (dark card 2 of 4; light card 2 of 3 with `Apply to all similar`).

Bottom sheet at 60–70% of window height (full height at `fontScale ≥ 1.3`) over the dimmed host app (`{colors.scrim}`). Glass body, grabber, `{rounded.lg}` top corners. **Header band:** `gradient.brand` 135°, 132dp tall from the sheet top, behind grabber, header and pager (capped at 45% in dark). **All text over the band is `{colors.on-glass-primary}` in both modes:** in dark, 62% glass over the 45% band over a scrimmed white host gives #F8FAFC 5.61:1 but #CBD5E1 only 3.96:1 (fail), so hierarchy there comes from type role, not ink. Header (min 112dp): amount (`headline`, tnum), merchant (`body-medium`), account + time (`caption`, e.g. `HDFC debit ••4821 · 8:42 pm`) left; `Later` text button top-right.

Order below the header: pager row (batch only: `Previous` left · `N of M` centre in `label` · `Skip` right; 48dp underlined text buttons) → decorative dots (6dp, centred, 12dp below) → **category grid** → **`Apply to all similar`** → **Remember row** → auto-approve line. Body scrolls; footer is sticky.

- **Category grid on glass (`category-grid-cell`):** 4 columns, 8dp gaps. Each cell = a full-width 48dp tile (`{rounded.md}`, `on-glass-primary` at 12%) with a 24dp `on-glass-primary` outline icon, then a `caption` label in `on-glass-primary`, centred, up to 2 lines (two-line height reserved so rows align). Selected (the guessed or chosen category): tile filled `on-glass-accent`, icon switches to filled weight in `bg-canvas-dark` (12.07:1 on the accent fill), label Medium; the fill is 4.85:1 (dark) / 5.41:1 (light) against the glass, and the filled icon carries selection without colour. Cells with subcategories carry a 12dp chevron at the tile's bottom-right. **No `cat-*` tints on glass** (their contrast is verified on solid surfaces only); icon + name identify the category.
- **`Apply to all similar`:** `button-text` on glass (`on-glass-primary`, underlined, 48dp), left-aligned, directly under the grid and above the Remember row. Rendered only when ≥2 cards in the batch share a merchant.
- **Remember for this merchant (`remember-toggle`):** a full-row 48dp checkbox row on glass, default checked. 24dp box with 4dp corners: checked = `on-glass-accent` fill + `bg-canvas-dark` check (12.07:1 on the accent fill); unchecked = 2px `on-glass-primary` outline. Label `body`, `on-glass-primary`.
- **Auto-approve line:** `Adds itself at 9:00 pm unless you reject it`, `caption`, secondary on-glass ink (#F8FAFC light, #CBD5E1 dark, 4.84:1 on the dark body), under the Remember row.
- **Sticky footer:** solid `glass-fallback` / `glass-fallback-dark`, padding 12dp × 16dp plus bottom inset; **Reject** (`button-secondary-on-footer`) left and **Approve** (`button-primary`) right, equal width, 12dp gap.

Account-discovery prompt and credit / transfer-type choices render as chip rows inside the card.

### Add sheet (`bottom-sheet`)

All bottom sheets share one anatomy: glass body, `{rounded.lg}` top corners, a 32×4dp grabber in secondary on-glass ink at 60%, `{colors.scrim}` behind, and a solid sticky footer (`glass-fallback` / `glass-fallback-dark`).

The Add sheet scrolls with a sticky footer holding Save. Top: `segmented-control` **Expense | Income | Transfer** (becomes a vertical radio list at `fontScale ≥ 1.3`). Then the quick-category chip row (Expense/Income) or From → To account pickers (Transfer), account chip, amount (`keypad` role), 3×4 keypad (`keypad-key`, min 56dp, grows), Save bottom-right (`button-primary`), `Save & add another` (`button-text`). Snap receipt / Share from UPI chips sit in the chip row when available.

### Selection bar (`selection-bar`)

Replaces the Activity header in selection mode: `✕` exit, `N selected` (`title-sm`), `Select all`, primary action (`Move N to…`). Solid surface; min 56dp.

### Setup card (`setup-card`)

Dashed `border-control` outline on `bg-surface`, `title-sm` + one sentence + `button-text`. Used for Plan setup cards and the dismissible SMS re-ask card (adds a 48dp close icon button).

### Stepper header (`stepper-header`)

`Step N of M` (`label`) + thin progress bar + Back. Used in the CSV wizard.

### Navigation rail (`nav-rail`)

≥600dp only: 80dp solid rail, ＋ at the top, then Home · Activity · Insights · Plan with labels; active = filled icon in accent + Medium label.

### Home-screen widget (`widget`, 4×1, resizable to 4×2)

**Solid surface** (launchers cannot blur), `bg-surface` / `bg-surface-dark` following the system theme, `{rounded.lg}`. Left: headline in `title-sm` (when amounts are enabled on the widget: `₹11,860 left` / `Over budget ₹2,340` / `Spent this period`; by default: no amount) and `N to check` caption (hidden at 0). Right: Snap and Add icon buttons (48dp) in `accent-primary`. At large text the headline wording ellipsises, never the amount. No numeric badge.

**4×2 size** (user-resizable; the size to use at large text): headline and `N to check` on the first row, Snap and Add buttons as a full-width second row, so nothing is dropped at 200% font scale. Same content and wording rules as 4×1.

### Empty state (`empty-state`)

Centred: small paper boat (96dp) on water, one sentence in `body` / `text-secondary`, one `button-primary`. Reduced motion: still frame.

### Tooltip (`tooltip`)

Inverse surface (`text-primary` background with `text-primary-dark` ink in light; swapped in dark), `{rounded.sm}`, 8dp pointer at the anchored control, max 280dp, `caption` type, `Got it` 48dp text button. At `fontScale ≥ 1.3` it renders as an inline card under the anchor instead of a floating pointer.

### Toast (`toast`)

Inverse: light = `text-primary` background, #F8FAFC text (17.06:1 on #0F172A), `Undo` in #5EEAD4 (12.07:1 on #0F172A). Dark = `bg-muted-dark` #334155 with a 1px `glass-border` outline, #F8FAFC text (9.90:1 on #334155), `Undo` #5EEAD4 (7.00:1 on #334155). Bottom, above the tab bar.

### Other library components

Skeleton (`skeleton`; the main app's loading indicator, never a spinner), coin-flip loader (Lottie; still pie face under reduced motion), Free to use figure (`headline`; `Short by ₹X` neutral `text-primary`, never red), KPI tile (`card` + `amount`), charts (Victory Native XL; every segment directly labelled; never on raw gradient; N/W/S rules above; a net refund surplus draws its bar at zero with a `₹7,000 back` label and the `refund-icon`, never a negative bar or minus sign). Free to use gate-fail is a single tappable row naming the missing required input: `Not enough information yet · Set a limit →` or `· Add an account →`.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Put glass only on hero, tab bar, sheets, capture sheet, pills | Glass on lists, Activity rows, the widget, over photos, or behind small non-on-glass text |
| Keep dark glass tint ≥62% and any gradient behind it ≤45% (locked); keep light glass at 80% | Lower the tint or raise the glow "for vibrancy" |
| Show "Over budget ₹2,340" unsigned with a warning icon, limit tick and hatched overflow | Minus signs, red fills, or colour-only overspend |
| Use tabular figures on every amount; cap and auto-fit hero amounts at large text | Proportional figures in amount columns; count-up animations; ellipsised amounts |
| Pair icon + text + colour for every state, including rejected / reversed / waiting tags | Colour or strikethrough as the only signal; emoji glyphs |
| Draw the primary button gradient on the #0F766E → #164E63 segment (white 5.47–9.11:1) | White text on the #2DD4BF end of the gradient (1.68:1) |
| Use `on-glass-primary` + underline for links on light glass | `on-glass-accent` or `on-glass-warning` as text on light glass |
| Use `on-glass-primary` for every line over the capture header band; use an on-glass ink outline for Reject on the light solid footer | `#CBD5E1` over the band (3.96:1); accent outline on #155665 (1.50:1) |
| Hide ratio text (`85% used`) with the bars when amounts are hidden | A visible percentage beside a hidden bar |
| Take category colours only from the 12 `cat-*` tokens | Free colour pickers; semantic income/expense/warning hues as category colours |
| Draw a visible focus ring on every focusable control | Relying on TalkBack's own highlight for keyboard and Switch Access users |
| Use the boat illustration for empty / relief moments | Boat or phrases on the calm hero; boat as app icon |
| Show a skeleton, then fade in | Spinners in the main app |
| Keep teal only in Phase 1 | Accent picker |
