# Accessibility Review — wmbugo-app

- **Lens:** accessibility (WCAG 2.2 AA + PRD NFR-11: TalkBack labels on every control, 200% font scale, reduced motion, 48dp targets, never colour alone, `View as table` on every chart)
- **Reviewed:** `DESIGN.md`, `EXPERIENCE.md` (draft, 2026-11-07), with `.memlog.md` and `.working/pass1-coverage.md`
- **Run at:** 2026-11-07
- **Method:** Contrast ratios computed with the WCAG 2.x relative-luminance formula (script in session scratch), alpha-compositing every glass, track and overlay token over its worst-case backdrop. Text ≥4.5:1 (≥3:1 for large text: ≥18.66dp bold or 24dp regular); non-text and state indicators ≥3:1 against adjacent colours (1.4.11).

## Overall verdict

The spines get the foundations right: on-surface text pairs all pass (lowest 4.79:1, income on canvas), every Activity state carries an icon, sign or tag, amounts are unsigned with words for direction, there are no badges and no OK-only dialogs, and the Accessibility Floor names TalkBack, 200% scale, 48dp and reduced motion. But the floor is stated as an outcome, not as a mechanism, and several of the spine's own visual choices break it. Two problems hit money correctness directly. First, the 200% rule ("never truncate amounts, never wrap digits") cannot be met by a 40sp hero or a side-by-side row amount at 320dp, and the spine gives no reflow or scaling cap. Second, the capture batch's swipe-and-auto-advance pattern can move TalkBack focus onto the next card's Approve button. The overspend cue the spine relies on (limit tick + hatched overflow) is not perceivable: the tick is 1.00:1 against the fill in light mode and the stripes are 1.03:1 against the fill in dark mode. The claim "all load-bearing pairs ≥3:1 non-text, including the locked glass floor" (EXPERIENCE.md › Accessibility Floor) is therefore not true yet. Dark-mode capture-sheet text over the uncapped gradient band fails (4.42:1). Focus indicators, disabled states, live regions and the Undo time limit are not specified at all. Everything here can be fixed inside the spines without changing a product decision.

Counts: **2 critical · 9 high · 19 medium · 8 low**.

## Critical

### C1. Amounts cannot meet "no truncation" at 200% font scale; no reflow mechanism specified
- **Location:** DESIGN.md › Typography (`display-amount` 40sp, `amount` 16sp, "amounts wrap the label, never the number"); DESIGN.md › Components › Home hero card, Activity row; EXPERIENCE.md › Accessibility Floor.
- **Problem:** At 200% the hero amount is ~80sp. Inter SemiBold tabular digits are ~0.6em wide, so `₹11,860` needs ~340dp and an en-IN lakh value `₹1,18,60,000` needs ~575dp. The hero's usable width at 320dp is 256dp (16dp margin + 16dp padding on each side). Android 14 non-linear scaling softens this, but minSdk is 26. Rows put the merchant and a 32sp amount side by side. In a finance app a clipped `₹1,18,6…` is a wrong number, and the spine bans both truncation and digit wrap without saying what happens instead. Developers will default to `numberOfLines={1}` and ellipsis.
- **Fix:** Add a "Large text" rule to DESIGN.md › Typography and Components:
  1. `display-amount` and `headline` cap scaling at `maxFontSizeMultiplier` 1.5 and then auto-fit the amount to the container width (`adjustsFontSizeToFit`, minimum 28sp). Never ellipsize an amount.
  2. Activity row: when `fontScale ≥ 1.3`, or when the measured amount width is more than 40% of the row, stack the amount on its own line under the title (right-aligned, still tnum). The leading icon chip stays 40dp.
  3. Hero `In accounts` and `Card dues` stack vertically above 1.3×.
  4. Add a test matrix row to NFR-11: 320dp × 200% × en-IN 9-digit amount × hidden/over-budget states.

### C2. Capture batch: gesture-only navigation and auto-advance can misdirect TalkBack approvals
- **Location:** EXPERIENCE.md › Interaction Primitives (swipe cards with auto-advance); Component Patterns › Swipe cards; DESIGN.md › Components › Capture sheet (page dots).
- **Problem:** Moving between cards is a horizontal swipe only, and TalkBack consumes single-finger swipes. Approve and Reject auto-advance by replacing the card in place, so TalkBack focus stays on the same screen position, which now belongs to the next card's Approve button. A second double-tap approves a transaction the user never heard. Without a gesture there is no way to skip a card or go back to a previous one: the only paths are deciding now or leaving the whole batch. Switch Access and one-handed users have the same problem.
- **Fix:** Spec in EXPERIENCE.md › Swipe cards:
  1. Visible `Previous` / `Next` (or `Skip`) text buttons beside `N of M`, each 48dp, in addition to the swipe. Also expose them as TalkBack custom actions on the card.
  2. After Approve or Reject, move accessibility focus to the new card's heading and announce `Approved Swiggy ₹420. Card 3 of 5: Zomato, 310 rupees, Food guessed`.
  3. Ignore activation on the Approve and Reject buttons for 500ms after the card changes.
  4. Under TalkBack or reduced motion, cross-fade instead of sliding.
  5. Dots are decorative (`importantForAccessibility="no"`); `N of M` is the accessible position.

## High

### H1. Over-budget limit tick and hatched overflow are not perceivable
- **Location:** DESIGN.md frontmatter `components.hero-bar` (`limit-tick` = `on-glass-primary`, `fill` = `on-glass-primary` light / `on-glass-accent` dark, `overflow` = `on-glass-warning` stripes); Components › Home hero card › Over budget; EXPERIENCE.md › Accessibility Floor ("overspend = icon + label + hatch").
- **Problem:** Computed: tick vs fill **1.00:1** in light (same colour) and **1.41:1** in dark. Overflow stripes vs fill: **1.38:1** in light and **1.03:1** in dark (#FCD34D vs #5EEAD4). Stripes vs track: 2.15–2.87:1 in light and 2.78:1 over the brightest dark glow. Fill vs track over white-backed light glass: 2.96:1. The "hatch" non-colour cue and the limit position both fall below 3:1. Over budget is still announced by the icon and label, but the bar cannot show where the limit is or how far over it the user went. The spine's ≥3:1 non-text claim does not hold.
- **Fix:** Give the tick a 1dp `glass-tint` gap (knockout) on both sides, extend it 3dp above and below the bar (2×14dp is already taller than the 8dp bar; keep it), and use a contrasting colour (`bg-canvas-dark` outline around an `on-glass-primary` core). Draw the overflow as `on-glass-warning` stripes on a **`glass-tint` (dark) base**, not on the track, separated from the fill by the tick gap. Re-verify with the script: stripe vs base ≥3:1, base vs fill ≥3:1. Fix the claim in Accessibility Floor to cite the verified numbers.

### H2. Dark capture sheet: text over the gradient header band fails contrast
- **Location:** DESIGN.md › Components › Capture sheet ("`gradient.brand` header band behind the merchant/amount line"); Colors › Glass (the locked ≤45% glow cap applies only to Home glows).
- **Problem:** The band is full-strength `gradient.brand`. Dark glass at the 62% floor over #2DD4BF gives `on-glass-primary` **4.42:1** and `on-glass-secondary-dark` **3.12:1**. The merchant line is `body`, not large text, so both fail. In light mode at 80% tint, secondary-as-#CBD5E1 would give 4.26:1. Light currently uses #F8FAFC there, which passes at 6.05:1.
- **Fix:** Either cap the header band at the same ≤45% opacity as the glows (this gives the 7.49:1 case), or start the band at `gradient-brand-mid`. Add a rule to Colors › Glass: "Any gradient behind glass obeys the glow cap, Home or not."

### H3. `on-glass-accent` used as text fails on light glass
- **Location:** DESIGN.md › Components › Home hero card (No budget: `Set a limit →` link in `on-glass-accent`); `tab-bar.icon-active`; Colors › Glass.
- **Problem:** #5EEAD4 on 80% light glass is **4.28:1** over #2DD4BF and **3.59:1** over white content. `Set a limit →` is `caption` (13sp), so it fails. Icons pass at ≥3:1. Any active tab label in accent would fail over white list content.
- **Fix:** On light glass, links and labels use `on-glass-primary` with an underline or the `→` glyph as the link cue. Reserve `on-glass-accent` for icons, fills and indicators in light mode. Add this to the "Ink on glass" bullet. If the tab bar gets labels, the active label uses `on-glass-primary` plus Medium weight; the filled icon carries the selection.

### H4. No focus indicator is specified (keyboard, Switch Access, hardware D-pad)
- **Location:** DESIGN.md (no focus token or component state); EXPERIENCE.md › Accessibility Floor ("Focus order follows reading order").
- **Problem:** WCAG 2.4.7 (Focus Visible) and 2.4.11 (Focus Not Obscured, new in 2.2 AA) apply to external keyboards, Chromebooks/tablets (≥600dp rail is in scope) and Switch Access, all of which draw focus on the app's own view, unlike TalkBack. With no UI kit, React Native draws nothing by default. The sticky glass tab bar, toasts and the capture sheet can also cover the focused row.
- **Fix:** Add tokens `focus-ring` (2dp, `accent-primary` light / `accent-primary-dark` dark, 2dp offset; ≥3:1 against both the control and the surface: 5.47:1 and 9.89:1) and `focus-ring-on-glass` (`on-glass-primary`, 2dp). Spec: every focusable control shows it. Lists scroll the focused row clear of the tab bar and toast (scroll padding = tab bar + toast height).

### H5. Undo toast is a time limit with no accessible duration
- **Location:** EXPERIENCE.md › Component Patterns › Toast ("Duration [ASSUMPTION]"); Interaction Primitives › Undo toasts; Open Question 14.
- **Problem:** Undo is the spine's main safety net for reversible actions ("act immediately + Undo"). A toast that times out removes it, and TalkBack users must navigate to the bottom of the screen to reach it. This is a WCAG 2.2.1 Timing Adjustable issue for a financial write.
- **Fix:**
  1. Duration = `AccessibilityManager.getRecommendedTimeoutMillis(10 000, FLAG_CONTENT_CONTROLS)`, minimum 10s.
  2. Pause while touched or focused, and stay until the next user action when TalkBack is on.
  3. Announce `Saved. Undo available` via a polite live region.
  4. Every Undo also has a durable path: entry detail › Restore, Show rejected, Recently deleted. Name that path in the toast spec.

### H6. Typed `RESTORE` confirmation is a cognitive and motor barrier
- **Location:** EXPERIENCE.md › Component Patterns › Typed confirmation; Interaction Primitives; FLOW-10 step 5; `.memlog.md` (decision) Restore.
- **Problem:** Typing an English capitalised word is hard for users with dyslexia, tremor, low literacy or a non-Latin IME. Autocorrect and auto-capitalisation fight it, and TalkBack users have to type letter by letter. Restore is often done under stress. The spine already has stronger safeguards: a preview card, a safety copy, and re-auth when lock is on.
- **Fix:** Replace typing with a two-step explicit confirmation: a checkbox `I understand this replaces what's on this phone now` (48dp, full-row target) that enables `Restore`, plus re-auth when lock is on. If a typed check is kept, make it case-insensitive, trim whitespace, disable autocorrect and suggestions, localise the word, label the field `Type RESTORE to confirm`, and announce `Restore button enabled` when it matches.

### H7. Split editor: remainder not announced; disabled Save gives no reason
- **Location:** EXPERIENCE.md › Component Patterns › Split editor; FLOW-05.
- **Problem:** `Left to assign ₹X` and `₹X too much` change silently for screen-reader users, and Save is disabled with no announced reason. A TalkBack user hears only "Save, disabled".
- **Fix:**
  1. Make the remainder line a polite live region, debounced 500ms after the last keystroke.
  2. Give Save an accessibility hint: `Assign the remaining ₹X to save`.
  3. Keep Save focusable when disabled (do not remove it from focus order).
  4. `Fill` gets the label `Fill: assign ₹X to Groceries`.
  5. Over-assignment uses the warning icon plus text, not colour alone.

### H8. Rejected, Reversed and Waiting rows rely on styling alone (visually and for TalkBack)
- **Location:** DESIGN.md › Components › Activity row (Rejected = "whole row `text-secondary`"; Reversed = strikethrough; Waiting = dashed outline); EXPERIENCE.md › Accessibility Floor ("row states = tag text or outline style").
- **Problem:** Rejected is distinguished by grey colour only, which fails 1.4.1 when mixed with live rows under Show rejected. Strikethrough and dashed outlines are not exposed to TalkBack. The capture vocabulary (`Waiting for you`, `Rejected`) exists but is not rendered on these rows.
- **Fix:** Add status tags `rejected`, `reversed` and `waiting` to those row states, so every one of the 11 states has visible text. Keep the strikethrough and outline as secondary cues. Specify that the row's accessibility label includes the state word.

### H9. Sheets, keypad, segmented control and chips use fixed heights that break at 200%
- **Location:** DESIGN.md frontmatter `segmented-control.height` 40dp, `keypad-key.height` 56dp, `chip.height` 32dp, `capture-sheet.height` 60–70%; Components › Add sheet.
- **Problem:** At 200%, `Expense | Income | Transfer` label text (14sp→28sp) cannot fit three segments of about 96dp at 320dp width, so `Transfer` clips. 28sp keypad digits become 56sp inside 56dp keys. The Add sheet's stack (segmented, chips, account, amount, 4 keypad rows, Save) exceeds the screen, and Save sits bottom-right below the fold.
- **Fix:** Turn heights into **minimums** (`min-height`) everywhere text lives. At ≥1.3×, the segmented control may wrap to a vertical radio list. Keypad keys grow (min 56dp), and keypad digits cap at `maxFontSizeMultiplier` 1.5. Sheets become scrollable with a sticky footer holding `Save` / `Approve` / `Reject`. The capture sheet may go full-height at large font scale.

## Medium

### M1. Segmented control: below 48dp and semantics unspecified
- **Location:** DESIGN.md › Components › Segmented control (40dp); EXPERIENCE.md › Component Patterns › Segmented control.
- **Problem:** A 40dp track is below NFR-11's 48dp target. The spec doesn't say whether segments are tabs or radios, so TalkBack may read "Income, button" with no state or position.
- **Fix:** 40dp visual, 48dp hit area (`hitSlop`). Each segment uses `accessibilityRole="radio"` inside a `radiogroup` labelled `Entry type`, with `selected` state and `1 of 3`. Announce the field change after a switch (`Transfer selected. From and To accounts shown`).

### M2. Filter chip removal: target, label and focus after removal unspecified
- **Location:** EXPERIENCE.md › Component Patterns › Filter chip row ("tap ✕ removes"); DESIGN.md › Chips.
- **Problem:** A ✕ icon inside a 32dp chip is far below 48dp if only the icon is the target. The label is unspecified, and focus is lost when the chip disappears.
- **Fix:** The whole chip is the remove target, labelled `Remove filter: HDFC debit`. After removal, focus moves to the next chip, or to `Filters · N` if none remain. Announce `Filter removed. 42 results`. `Clear all` announces the result count.

### M3. Inline text links in the hero are below 48dp
- **Location:** DESIGN.md › Home hero card (`Set a limit →`, `includes ₹X not classified — sort it`); EXPERIENCE.md › Free to use (`Set a limit →`).
- **Problem:** Caption-size inline links fall below the 48dp target. `→` and `—` are read literally by TalkBack ("right arrow").
- **Fix:** Make each link a 48dp-tall row or button, with accessibility labels `Set a limit` and `Sort ₹X of unclassified spending`. Mark the arrows decorative.

### M4. Hero card: nested controls and announcement unspecified
- **Location:** EXPERIENCE.md › Component Patterns › Home hero card; Accessibility Floor.
- **Problem:** The hero is a tap target (to SCR-15) that contains another control (the eye). Without a spec, TalkBack fragments it into 6–8 stops. `~₹988/day` will be read as "tilde 988 rupees slash day", and the bar has no progress semantics.
- **Fix:** The hero is one merged focus node: `Left in budget, 11,860 rupees. Spent 8,140 of 20,000. About 988 rupees per day, 12 days left. In accounts 52,300 rupees. Card dues 4,100 rupees. Double-tap for budget details`. The eye is a separate following node: `Hide amounts, toggle, off`. Over budget reads `Over budget by 2,340 rupees`. The bar is decorative inside the merged label. Provide a `accessibilityLabel` builder from the read model, not from the visible string.

### M5. Activity row: merged announcement order and actions unspecified
- **Location:** EXPERIENCE.md › Accessibility Floor ("Tags are read as part of the row"); Component Patterns › Activity row.
- **Problem:** The announcement order, the direction word for unsigned expenses and the custom actions are not set. A Check row opening review is not discoverable.
- **Fix:** Fix the order as merchant → amount with direction (`spent 420 rupees` / `income, plus 85,000 rupees` / `transfer 5,000 rupees` / `USD 12.99, waiting for currency`) → category → account → state tags → date. Check rows add the hint `Double-tap to review possible duplicate`. Add custom actions where the detail screen offers them (Recategorize, Delete), each with Undo.

### M6. Gesture-only or hidden paths lack visible alternatives
- **Location:** EXPERIENCE.md › Interaction Primitives (Sheets: swipe down = decide later; Long-press ＋ → camera; category cell → subcategories); Component Patterns › Category icon grid.
- **Problem:** "Decide later" on the capture sheet is swipe-down or system Back only, with no visible button. Subcategories are reachable only by long-press in the capture grid. Long-press ＋ has no TalkBack action.
- **Fix:**
  1. Add a visible `Later` text button in the capture-sheet header (48dp).
  2. Category cells with subcategories show a small chevron or `More` cell. Picking the category opens an inline subcategory row (optional), and a custom action `Choose subcategory` is exposed.
  3. ＋ exposes the custom action `Snap receipt`, and the Add sheet's `Snap receipt` chip is always present where OCR exists.
  4. State in Interaction Primitives: "Every gesture has a visible control."

### M7. 21:00 auto-approve is a silent time limit on captures
- **Location:** EXPERIENCE.md › FLOW-09 step 4; Capture Surfaces; Settings hub (`Auto-approve 21:00`).
- **Problem:** Captures the user doesn't act on are written at 21:00. Users who are slow to interact are not told on the capture itself, so an unreviewed entry becomes a recorded fact.
- **Fix:** The capture sheet and notification state `Adds itself at 9:00 pm unless you reject it`, and TalkBack reads it. The time is adjustable (it already is) and can be turned off (`Never — always wait for me`). The evening summary links to Undo/Reject for those entries.

### M8. Reduced-motion coverage incomplete
- **Location:** EXPERIENCE.md › Interaction Primitives › Motion; Accessibility Floor; FLOW-08 step 2 (scan line); DESIGN.md › Hero (fade-in).
- **Problem:** The OCR scan line (PRD OCR-014 says reduced motion shows the progress bar only), the card auto-advance transition, toast slide-in and the brief `All checked` dismissal are not covered.
- **Fix:** List every animated element with its reduced-motion form: scan line → static photo + determinate progress bar; card change → instant swap + focus move (C2); toasts and sheets → fade ≤150ms or none; `All checked` → stays until tapped, or 4s plus announcement. Respect both `ANIMATOR_DURATION_SCALE` and an in-app toggle.

### M9. Widget and notification at 200% / large text
- **Location:** EXPERIENCE.md › Capture Surfaces › Widget; Notifications › Evening summary; DESIGN.md › Home-screen widget.
- **Problem:** A 4×1 cell is fixed height. `title-sm` at 34sp plus a caption and two buttons will clip in RemoteViews. Expanded notification lines `Merchant ₹amount · Category` get truncated by the system from the end, which cuts the amount off.
- **Fix:** Widget: at large scale, drop the `N to check` caption to a second resize class (4×2), give the Snap and Add icon buttons 48dp with content descriptions, and never ellipsize the amount (ellipsize the label). Notification lines lead with the amount: `₹420 · Swiggy · Food`. Notification actions have full labels (`Approve ₹420 Swiggy`).

### M10. Needs / Wants / Savings series and chart series contrast
- **Location:** DESIGN.md › Colors › Needs / Wants / Savings; Components (charts); EXPERIENCE.md › Charts; Open Question 8.
- **Problem:** Against surfaces: wants 2.49:1 and savings 1.48:1 on white; needs 2.67:1 on dark surface. Between series: needs vs wants 2.20:1 and wants vs savings 1.68:1, so stacked or adjacent segments and the coin pie can't be told apart. Direct labels satisfy 1.4.11 only if every segment carries its own label. `semantic-expense` vs `semantic-income` in charts is hue-only.
- **Fix:** Separate adjacent segments with a 2dp `bg-surface` gap. Label every segment directly (label + value + %), and put labels outside when a segment is too small to hold one. Give dark-mode variants (for example needs #2DD4BF on dark). Add pattern or marker shapes per series (solid, dotted, hatched) in comparison charts. Expense/income series also use the sign (`+`) and legend text. Keep `View as table` on every chart (already specced). Table rows are tappable, matching the bar-tap drill-down.

### M11. Disabled-state visuals and semantics undefined
- **Location:** DESIGN.md frontmatter `components` (no `disabled` for buttons/chips); EXPERIENCE.md › Split editor (Save disabled), Typed confirmation (Restore disabled).
- **Problem:** Disabled controls are exempt from contrast, but they must look disabled in a way that does not rely on colour alone, and TalkBack must announce the state.
- **Fix:** Add `button-primary-disabled`: solid `border-hairline` / `text-secondary` ink (7.58:1 for legibility), no gradient. Set `accessibilityState={{disabled:true}}` and a hint giving the reason (see H7).

### M12. One-time tips: focus behaviour and dismissal target unspecified
- **Location:** EXPERIENCE.md › Interaction Primitives › One-time tips; DESIGN.md › Tooltip ("tap anywhere on it").
- **Problem:** "Announced by TalkBack" and "never steals focus" conflict unless the mechanism is stated. A tooltip at 280dp can cover its anchor at 200%.
- **Fix:** Announce via a polite live region. The tip is inserted in focus order immediately after its anchor, with a 48dp `Got it` button. At large scale it renders as an inline card under the anchor instead of a floating pointer.

### M13. Passphrase entry: paste, password managers and strength feedback
- **Location:** EXPERIENCE.md › Component Patterns › Passphrase field; FLOW-10.
- **Problem:** WCAG 3.3.8 (Accessible Authentication, AA) requires that users can paste or use a password manager. The spec is silent, and secure-entry implementations often block paste. A mismatch between the passphrase and confirm fields and the strength hint have no announcement spec.
- **Fix:** State explicitly: paste allowed, `autoComplete="password-new"` / `"password"`, `Show` toggle labelled `Show passphrase, toggle`. The strength hint and the mismatch error (`Passphrases don't match`) are polite live regions, with text and an icon. A wrong passphrase on restore keeps the field content.

### M14. Capture category grid: label text and category colours unspecified
- **Location:** DESIGN.md › Capture sheet (category icon grid, 4 columns); `category-icon-chip` ("category colour at 16%"); Open Question 5.
- **Problem:** The grid cells read as icon-only. Icons are ambiguous for cognitive users and need labels for TalkBack. With no palette, light category colours on their own 16% tint can land around 2.1:1 (e.g. #14B8A6).
- **Fix:** Put a text label under every icon (`caption`, 2 lines, never truncated to a single letter), with the accessibility label `Food, category`. Validate the category palette at ≥3:1 for each icon on its tint in both themes before it lands.

### M15. Inline errors are not announced
- **Location:** EXPERIENCE.md › State Patterns › Error; FLOW-02 failure ("inline error, all input kept").
- **Problem:** Inline errors are invisible to TalkBack unless focus moves to them or they are announced.
- **Fix:** On submit failure, move accessibility focus to the first invalid field. The field's error text is attached to it (`accessibilityLabel` includes `Error: amount required`). Screen-level errors use an assertive live region once.

### M16. Dark glass over light imagery falls below 4.5:1
- **Location:** DESIGN.md › Colors › Glass (dark worst case computed only over glows and #1E293B).
- **Problem:** Receipt photos (SCR-23, attachments in SCR-08) scroll under the dark-mode tab bar and sit behind sheets. Over white image areas the 62% glass gives #F8FAFC **3.22:1** and #CBD5E1 2.27:1.
- **Fix:** Add a rule: glass over image content uses `glass-fallback-dark`, or raise the tab-bar tint to ≥80% when imagery is in the scroll view. Alternatively, inset images so they never pass under the tab bar.

### M17. Home card reorder needs a non-drag alternative
- **Location:** EXPERIENCE.md › IA (SCR-05 Home card editor); pass1-coverage (SCR-05 behaviour unspecified).
- **Problem:** WCAG 2.5.7 (Dragging Movements, AA) requires a single-pointer alternative to drag-to-reorder.
- **Fix:** Each card row has `Move up` / `Move down` buttons (or custom actions) and a `Hide` switch. Announce the new position (`Bills moved to position 2 of 6`).

### M18. Custom amount keypad accessibility
- **Location:** EXPERIENCE.md › Component Patterns › Amount keypad; DESIGN.md › `keypad-key`.
- **Problem:** A custom keypad replaces the IME, so TalkBack labels, the delete key and hardware-keyboard input must be designed in.
- **Fix:** Keys are labelled `1`…`9`, `0`, `decimal point` (locale-aware) and `Delete`. The entered amount is a live region read in full (`12 point 50 dollars`). Hardware number keys and Backspace work. Long-press Delete clears, with a visible `Clear` alternative.

### M19. Over-budget and threshold states beyond the hero have no non-colour spec
- **Location:** EXPERIENCE.md › FLOW-06 (thresholds); IA (SCR-14/15 Budget list/detail); DESIGN.md › Colors (`semantic-warning` "over budget, limits, due soon").
- **Problem:** Only the hero defines icon, label and hatch. Category budget bars, bill "due soon" and threshold statuses rely on `semantic-warning` with no required icon or text.
- **Fix:** Generalise the hero rule into a `limit-bar` component (tick, overflow treatment, `Over by ₹X` text, warning icon). Require the text `Due in 2 days` / `80% used` next to any warning tint.

## Low

### L1. Page dots are below 3:1 and below the target size
- **Location:** DESIGN.md › `capture-sheet.page-dots` (6dp; inactive vs glass 2.1–2.6:1, active vs inactive 1.7–2.1:1).
- **Problem:** Acceptable only if the dots are decorative.
- **Fix:** Mark them non-interactive and hidden from TalkBack. `N of M` carries the position (see C2).

### L2. Dark toast has no boundary against cards
- **Location:** DESIGN.md › `toast.background-dark` = `bg-surface-dark`.
- **Problem:** Toast vs card: 1.00:1. Toast vs canvas: 1.22:1. The toast blends into the content under it.
- **Fix:** Use #334155 or a 1px `glass-border` outline for the dark toast background.

### L3. Unselected chips and hairline borders are about 1.2:1
- **Location:** DESIGN.md › `chip.border` (`border-hairline` #E2E8F0: 1.23:1 on white, 1.18:1 on canvas; dark: 1.19:1).
- **Problem:** The chip's boundary is nearly invisible. The text label identifies the control, but its extent and hit area are unclear to low-vision users.
- **Fix:** Unselected chips use a `text-secondary` 1px border, or a `bg-surface` fill on canvas.

### L4. Activity tab pending dot unspecified
- **Location:** EXPERIENCE.md › IA (Activity: "small dot on the tab (no count)").
- **Problem:** No colour, size or accessibility label is defined for the dot.
- **Fix:** 8dp `on-glass-warning` dot (3.68:1 or better on light glass). The tab label becomes `Activity, items to check`.

### L5. "Check" tag vs vocabulary
- **Location:** DESIGN.md › Activity row (`Check` tag); EXPERIENCE.md › Voice and Tone (`Possible duplicate — check it`).
- **Problem:** `Check` alone is ambiguous when spoken.
- **Fix:** Use the tag `possible duplicate`, or keep the visible `Check` with the spoken label `possible duplicate, check it`.

### L6. `View as table` structure unspecified
- **Location:** EXPERIENCE.md › Charts; PRD acceptance at line 618.
- **Problem:** The table's structure for TalkBack is not specified.
- **Fix:** Table rows are single merged nodes (`Food, 4,200 rupees, 32 percent`), the header row is announced as headers, the table follows the scope label (`Spent · HDFC only`), and the same drill-down applies on tap.

### L7. ＋ button icon over the light gradient region
- **Location:** DESIGN.md › `add-button` (135° full `gradient.brand`).
- **Problem:** White on #2DD4BF is 1.86:1. The plus arms span roughly 37–63% of the diagonal, near the mid stop (about 3–5:1), so the icon probably passes. It is unverified.
- **Fix:** Verify ≥3:1 at the arm tips, or use the mid→end segment as `button-primary` does. Label the button `Add entry`, with the custom action `Snap receipt`.

### L8. Hidden amounts: mask spoken form and bar leak
- **Location:** DESIGN.md › Hero (Amounts hidden: "bar shown"); Open Question 6.
- **Problem:** A `••••` mask is read as "bullet" by some TalkBack versions. A visible bar or progress value still discloses the proportion spent.
- **Fix:** Every masked amount carries the label `Amount hidden`, and the mask glyph is hidden from accessibility. Under hidden amounts the hero bar exposes no value, and chart tables mask values too.
