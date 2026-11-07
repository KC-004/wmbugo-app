---
name: wmbugo-app
status: final
created: 2026-11-07
updated: 2026-11-07
sources:
  - ../../prds/prd-wmbugo-app-2026-11-01/prd.md
  - ../../prds/prd-wmbugo-app-2026-11-01/addendum.md
  - ../../architecture/architecture-wmbugo-app-2026-11-07/ARCHITECTURE-SPINE.md
---

# wmbugo — Experience Spine

> How the app behaves. Visual tokens and component visuals live in [DESIGN.md](DESIGN.md) and are referenced as `{path.to.token}`. Decisions come from `.memlog.md` (canonical; where it overrides the PRD, the memlog wins — see Deviations). Product requirements, personas, FR text and flow outlines stay in the sources above and are referenced by ID, not copied. **This file and DESIGN.md (the spines) win over any mock, wireframe or import when they conflict.**

Approved key-screen mocks, linked inline where they apply: [mockups/key-home.html](mockups/key-home.html) (Home), [mockups/key-activity.html](mockups/key-activity.html) (Activity), [mockups/key-capture-batch.html](mockups/key-capture-batch.html) (capture sheet batch). Exploratory: [.working/dark-glass-options.html](.working/dark-glass-options.html) (glass options).

## Foundation

- **Platform:** Android only in Phase 1 (minSdk 26, targetSdk 36). iOS is Phase 2.
- **Stack:** React Native CLI (New Architecture, Hermes, TS strict); React Navigation (root stack → bottom tabs → per-tab stacks). **No UI kit** (no Material, no shadcn); DESIGN.md is the visual system and is implemented in `src/shared` (glass, gradients, coin loader, formatter, focus ring, accessibility-label builders).
- **Form factor:** phone portrait 320–430dp is the baseline; wider screens and landscape follow Responsive & Platform.
- **Context:** fully offline, no sign-in, no `INTERNET` permission. Every number shown comes from the on-device read model (AD-15); screens never format money themselves (shared `Intl` formatter).
- **Stakes:** consumer personal finance with highly sensitive data; no money movement; correctness is release-blocking (RB0).
- **Theme:** System / Light / Dark. Teal only; no accent picker in Phase 1.

## Information Architecture

**Primary navigation:** bottom tabs **Home · Activity · ＋ · Insights · Plan** (PRD §5.1). ＋ is a tab-bar button that opens the Add sheet modal, not a destination; long-press ＋ (or its `Snap receipt` custom action) opens the camera for a receipt. Every tab has a header with the **Accounts** icon and the **avatar → Settings hub**; screens add their own actions before them (Activity: Search, `Select`). Home's header is a greeting (`Good evening`) and the date instead of a screen title. Large-text header behaviour: Accessibility Floor › Large text. No drawer. Back follows Android conventions; tab state persists when the user switches tabs briefly. Illustrated in [mockups/key-home.html](mockups/key-home.html) (Home header, tab bar with the Activity pending dot) and [mockups/key-activity.html](mockups/key-activity.html) (Activity header, both scales).

**Root stack:** LockGate (app lock) → onboarding (SCR-01–03) → tabs; modals: Add sheet, filter sheet, selection sheets, long-task loader (SCR-31), restore confirmation. Deep links, widget, notifications and share intents all pass LockGate first; a share received while locked is queued and delivered after unlock.

| Tab / container | Stack (root first) | Notes | Journeys |
|---|---|---|---|
| Home | SCR-04 Home → SCR-05 Home card editor (`Edit Home` at the bottom) · SCR-15 Budget detail (hero tap) · SCR-10 Review queue (`N to check` card) · SCR-30 Needs / Wants / Savings | `N to check` card only when captures are pending; SMS re-ask card when eligible | FLOW-01, 02, 06, 14 · J-HOMEEDIT · J-SMS-REASK |
| Activity | SCR-07 Activity → SCR-08 Transaction detail · SCR-10 Review queue (a row tagged `Check`) · selection mode → Bulk recategorise (TXN-010) | Small dot on the tab (no count) when pending | FLOW-05, 18 · J-FUEL · J-EVENING |
| ＋ (modal) | SCR-09 Add sheet; long-press → camera → SCR-31 loader → SCR-23 Receipt OCR review | `Snap receipt` / UPI chips only where available | FLOW-02, 03, 04, 08, 17 |
| Insights | SCR-11 Insights overview → SCR-12 Insight drill-down → filtered Activity → SCR-08 | Filtered Activity is pushed inside the Insights stack so Back restores the filter | FLOW-11 · J-FUEL |
| Plan | SCR-13 Plan hub → SCR-14 Budget list/editor · SCR-15 Budget detail · SCR-16 Bills/recurring · SCR-17 Savings goals · SCR-30 | Opens on the `Before payday` timeline with `Free to use` | FLOW-06, 14 · J-BILLS · J-GOAL |
| Header (all tabs) | Accounts icon → SCR-06 Accounts list/detail (pushed on the current tab) · avatar → SCR-21 Settings hub | | FLOW-15, 17 · J-NOTIF |

**Settings hub (SCR-21):** six group rows, each opening a sub-screen, each showing a live one-line state summary.

| Group | Contains | Example summary | Journeys |
|---|---|---|---|
| You | Payday, period, theme (System/Light/Dark), number format, haptics, reduce motion | `Payday 1st · Dark` | FLOW-01 |
| Money | SCR-18 Categories | `14 categories` | J-FUEL |
| Capture | SCR-24 SMS capture (India, approved build only), auto-approve time (or Off), notifications, lock-screen approve, SCR-28 Learned merchants & blocked senders | `SMS on · Auto-approve 21:00` | FLOW-09 · J-NOTIF · J-SMS-REASK · J-LEARN |
| Privacy | App lock, hide amounts, app-switcher blur, notification detail (links to Capture › Notifications) | `App lock on · Amounts shown · Notifications: full` | FLOW-12 · J-NOTIF |
| Data | SCR-20 Backup / restore / export CSV, SCR-19 Import CSV, storage, Recently deleted, wipe | `Last backup 3 Nov` | FLOW-07, 10 · J-RESTORE-DELETED |
| Help | How totals work, glossary, SCR-22 Diagnostics (incl. OEM background help), about | — | FLOW-09 (failure) |

**Surfaces outside the app** (behaviour in Capture Surfaces outside the App and Notifications):

| Outside surface | Journeys |
|---|---|
| Splash | FLOW-01 |
| SCR-27 Capture sheet | FLOW-09, 13, 15, 16 · J-LEARN |
| SCR-29 Widget | FLOW-08 (widget Snap) |
| Capture notification | FLOW-09 · J-NOTIF |
| Evening summary | J-EVENING |
| Budget threshold / bill reminder notifications | FLOW-06 · J-BILLS |
| Share target | FLOW-13 |
| App-switcher snapshot, LockGate | FLOW-12 |

**Every SCR mapped:** SCR-01–24 and SCR-27–31 appear above with at least one journey. SCR-25 (Automation rules) and SCR-26 (Advanced reports) are Phase 2 and have no Phase 1 surface. Features unavailable in the user's market or build are absent, never "coming soon".

## Voice and Tone

Microcopy rules from PRD §6.7 apply in full (calm not guilty; reassure on reversible actions; "Rough is fine"; say what we don't know; plain money words; celebrate lightly). Brand voice is in DESIGN.md › Brand & Style. Decided specifics:

| Do | Don't |
|---|---|
| `Over budget ₹2,340` · `5 days to payday` | `-₹2,340 left`, `You overspent!`, any nudge copy |
| `~₹988/day · 12 days left` (`~` = rough guide) | Exact-sounding per-day promises |
| `3 to check` | `Inbox`, numeric badges, `You have 3 unread` |
| `Not enough information yet · Set a limit →` or `· Add an account →` (names the one missing required input) | A checklist of everything missing |
| `Shopping · ₹7,000 back` (refund icon) when refunds exceed spending | A minus sign or negative bar on a net figure |
| `Short by ₹1,200` (neutral) | Red or alarm wording |
| `All checked` (with boat) | Confetti, exclamation marks |
| `No goals yet. Saving for something? · Add a goal` | `Nothing here!` |
| `Couldn't read this receipt. Nothing was saved. · Try again · Enter it by hand` | `Error 0x13`, OK-only dialogs |
| `We can't recover this. Without it, the backup can't be opened.` | Scary warnings in caps |
| `If something goes wrong during restore, nothing on this phone changes.` · `Back up this phone first` | `We'll keep a safety copy…` or any promise the architecture doesn't keep (AD-10 keeps the pre-restore copy only until the next successful start) |
| `I understand this replaces what's on this phone now` | `Type RESTORE to confirm` |
| `Adds itself at 9:00 pm unless you reject it` | Silent auto-approval |
| `Amounts look like S$1,234.50` (live format preview) | Abstract format codes |
| `Turn off anytime in Settings › Capture` | Hiding the exit |
| `Tired of typing payments? Let wmbugo read bank SMS` | Re-asking after two dismissals |
| Expenses unsigned, income `+₹85,000` | Minus signs anywhere |

Capture status vocabulary (shared with architecture, addendum §3): `Waiting for you` · `Possible duplicate — check it` · `Looks like a scam — not added` · `Recorded · category guessed` · `Recorded · needs a category` · `Recorded` · `Rejected`. Every typed `Result` code maps 1:1 to a copy entry.

## Component Patterns

Behavioural rules. Visuals in DESIGN.md › Components. Mocks: Home hero and cards in [mockups/key-home.html](mockups/key-home.html); Activity row, day headers and filter chip row in [mockups/key-activity.html](mockups/key-activity.html); capture sheet, swipe cards, category grid, `Apply to all similar` and Remember row in [mockups/key-capture-batch.html](mockups/key-capture-batch.html). Every component below gets a TalkBack label with role and state, a visible focus ring, and a 48dp target (see Accessibility Floor).

### Home hero card

- **Use:** SCR-04.
- **Behaviour:** Tap anywhere (except the eye) opens SCR-15 budget detail (or budget setup when none). The eye toggles hide-amounts globally; the state is remembered (profile setting). The daily line divides Left by days to payday when payday is set, otherwise by days to period end. Values fade in on change; never count up.
- **TalkBack:** one merged node built from the read model, e.g. `Left in budget, 11,860 rupees. Spent 8,140 of 20,000. About 988 rupees per day, 12 days left. In accounts 52,300 rupees. Card dues 4,100 rupees. Double-tap for budget details`; over budget reads `Over budget by 2,340 rupees`; the bar is decorative inside it. The eye is the next node (`Hide amounts, toggle, off`). `Set a limit` and `Sort ₹X of unclassified spending` are separate 48dp nodes; arrows are decorative.
- **States:** State Patterns › Hero states.

### Activity row

- **Use:** SCR-07, SCR-12 drill-down, SCR-30.
- **Behaviour:** The whole row is the tap target → SCR-08; a row tagged `Check` opens SCR-10 review (hint `Double-tap to review possible duplicate`). Tags are not buttons. Long-press or the toolbar `Select` button enters selection mode. Custom actions mirror the detail screen (`Recategorise`, `Delete`), each with Undo. **Day headers** (`Today · Sat 7 Nov`, `Yesterday · Fri 6 Nov`, then `Thu 5 Nov`) show `Spent ₹X` for the (filtered) day from the read model, **refund-net**: confirmed expenses minus refunds received that day, floored at `₹0`; income, transfers and pending (waiting, possible duplicate), reversed and rejected entries are excluded (e.g. ₹1,500 fuel and a ₹1,299 refund → `Spent ₹201`).
- **TalkBack:** order is merchant → amount with direction (`spent 420 rupees` / `income, plus 85,000 rupees` / `refund, plus 1,299 rupees` / `transfer 5,000 rupees` / `USD 12.99, waiting for currency`) → category → account → state tags (`Check` is read `possible duplicate, check it`) → date. The return icon is decorative. Day headers are read as headings (`Thursday 5 November, spent 201 rupees`).
- **States:** row states in DESIGN.md › Components › Activity row; rejected rows appear only when Show rejected is on.

### Swipe cards

- **Use:** capture sheet batch.
- **Behaviour:** One capture per card. `Previous` · `N of M` · `Skip` (48dp text buttons) plus swipe. Approve/Reject advances to the next card; Approve/Reject ignore activation for 500ms after a card change. `Apply to all similar` appears when cards share a merchant; it sits directly under the category grid, above `Remember for this merchant`, so it is reached right after choosing a category. No blind Approve all. `Remember for this merchant` is a checkbox, default on, per card.
- **TalkBack:** the same moves are custom actions on the card. After Approve/Reject, accessibility focus moves to the new card's heading and announces `Approved Swiggy ₹420. Card 3 of 5: Zomato, 310 rupees, Food guessed`. Dots are decorative; `N of M` is the accessible position. The Remember row reads `Remember for this merchant, checkbox, checked`.
- **States:** under TalkBack or reduced motion the card change cross-fades; the last decision closes the sheet (see Interaction Primitives).

### Other components

| Component | Use | Behavioural rules |
|---|---|---|
| Selection mode | SCR-07 (TXN-010) | Entered by long-press on a row or `Select` in the toolbar. `selection-bar` shows `N selected`, `Select all` (current filtered set), `✕` exit, and `Move N to…` → category picker → preview (`Move N entries from <Category> to <Category>`, or `Move N entries to <Category>` when the sources are mixed; amounts unchanged) → Confirm → toast with Undo. Back exits selection without changes. **TalkBack:** rows announce `selected` / `not selected`. |
| Add sheet | SCR-09 | Opens on Expense with keypad focused. **Draft:** dismissing with unsaved input (swipe down, Back, scrim tap) keeps it as a draft silently, with no confirm dialog; reopening ＋ restores amount, type and category until the entry is saved or the user taps `Clear`. Save or `Clear` discards the draft. Only one draft exists. The draft lives in memory only (transient UI state, AD-15): it is cleared when the app locks or its process ends, and is never written to the database. |
| Quick-category chips | Add sheet, receipt review | One tap selects; ordered by use. Account pre-fills from the category. |
| Category icon grid | Capture sheet | Ordered by this merchant's history, then overall frequency. Each cell shows icon + name. The guessed category (if any) opens pre-selected. Tap = choose and save (single capture) or advance (batch). Cells with subcategories show a chevron; long-press, or the custom action `Choose subcategory`, opens them. **TalkBack:** each cell is a radio in a `Category` radiogroup (`Food & Drinks, selected, has subcategories`). |
| Filter chip row | SCR-07 | Horizontally scrolling above the list: `Filters · N` (opens the full filter sheet) then one removable chip per active filter; `Clear all` appears when two or more filters are active. The whole chip is the remove target. After removal focus moves to the next chip (or `Filters · N`). Filtering never changes Home. **TalkBack:** chips are labelled `Remove filter: HDFC debit`; removal announces `Filter removed. 42 results`. |
| Segmented control | Add sheet type | Expense (default) / Income / Transfer. Amount and keypad persist across switches. Expense/Income show quick categories + account; Transfer replaces categories with From → To pickers. At `fontScale ≥ 1.3` it renders as a vertical radio list. **TalkBack:** a `radiogroup` labelled `Entry type`; each segment is a radio with selected state and `1 of 3`; choosing Transfer announces `Transfer selected. From and To accounts shown`. |
| Amount keypad | Add sheet, foreign-amount entry | Opens when the sheet appears (amount first). Long-press Delete clears, with a visible `Clear`. Hardware number keys and Backspace work. Save bottom-right in the sticky footer. `Save & add another` keeps the sheet open and clears the amount. Inline validation keeps all input. **TalkBack:** keys are labelled `1`…`9`, `0`, `decimal point` (locale-aware), `Delete`; the entered amount is a polite live region read in full (`12 point 50 dollars`). |
| Split editor | SCR-08 (TXN-009) | Rows of category + amount; live `Left to assign ₹X` (polite live region, debounced 500ms); `Fill` assigns the remainder to the focused row (or the last row) (label `Fill: assign ₹X to Groceries`); Save disabled until remainder = 0, stays focusable, hint `Assign the remaining ₹X to save`; over-assignment shows warning icon + `₹X too much`. No silent auto-balancing. Receipt `Not itemised` is a split row, not a remainder. |
| Capture sheet | SCR-27 | Surface behaviour in Capture Surfaces outside the App. `Later` in the header, swipe down, or Back = decide later (stays pending in `N to check`). |
| Free to use | SCR-13 | Gate passes → amount with an estimate label. Gate fails → a single next step naming the missing required input: `Not enough information yet · Set a limit →` (no budget and no 50/30/20) or `Not enough information yet · Add an account →` (limit exists, no included account). Bills and goals are optional and never gate. Negative → `Short by ₹X`. Tap figure → "How we worked this out": Left in budget vs (included accounts − upcoming bills − set aside), highlighting the smaller. |
| Limit bar | SCR-14, 15, 17, 30, Home cards | Any bar with a limit shows the tick, capped overflow and a status text whenever warning tint appears (`Over by ₹X`, `80% used`, `Due in 2 days`). While amounts are hidden the bar and any percentage status are not rendered or read; `Over by ₹ ••••` and day-based statuses stay. **TalkBack:** reads the status text, not the bar. |
| Toast | Save, delete, reject, recategorise | One at a time, bottom above the tab bar, always with `Undo` for reversible actions. Duration = `getRecommendedTimeoutMillis(10000, FLAG_CONTENT_CONTROLS)`, never under 10s; pauses while touched or focused; under TalkBack stays until the next user action. Never blocks input. Each Undo has a durable path once the toast is gone: entry detail (edit / recategorise), Show rejected, or Settings › Data › Recently deleted. **TalkBack:** announced via a polite live region (`Saved. Undo available`). |
| Tooltip (one-time tip) | ONB-005 tips | Pointer tooltip anchored to the relevant control, shown the first time something happens (e.g. after the first manual save, a tip on long-press ＋). Max one per session; never over an open sheet or dialog; no auto-dismiss (`Got it`). At `fontScale ≥ 1.3` it renders as an inline card. Tips never insert data. **TalkBack:** announced via a polite live region and inserted in focus order right after its anchor; never steals focus. |
| Empty state | All screens | Boat + one sentence of what belongs here + one primary action. |
| Error retry | All screens | Inline: cause + data reassurance + retry + alternative path. On submit failure focus moves to the first invalid field, whose label includes the error (`Error: amount required`); screen-level errors use an assertive live region once. |
| Widget | SCR-29 | See Capture Surfaces outside the App. |
| Settings group row | SCR-21 | Tap → sub-screen. Summary text updates live and is part of the row label. |
| Setup card | SCR-13 empty, Home SMS re-ask | One action. Dismissible cards (re-ask) have a 48dp close button labelled `Dismiss`; dismissal is remembered. |
| Home card editor | SCR-05 | List of Home cards; hero pinned first and cannot be hidden. Each row: drag handle, `Move up` / `Move down` buttons (also custom actions), `Hide` switch, compact/full where supported. `Reset to default` restores the PRD order. Changes apply on Back. **TalkBack:** announces `7-day spend hidden` / `Needs, Wants, Savings moved to position 2 of 6`. |
| Learned merchants list | SCR-28 | Rows `Swiggy Instamart → Groceries` with `Edit` / `Forget`; mixed merchants show `mixed` tag + `Clear mixed`; blocked senders section with `Unblock`. Forget and Unblock give an Undo toast. Search at top when > 20 rows. |
| Coin-flip loader | SCR-31, splash | Shows progress (`3 of 14 items`) + reassurance + Cancel where cancellable. Progress is a polite live region. Reduced motion: still pie face. |
| Restore confirmation | SCR-20 | Preview card (backup date, entries, accounts vs `This phone now`), `If something goes wrong during restore, nothing on this phone changes.`, `Back up this phone first` link (opens Backup, then returns). `checkbox-row` `I understand this replaces what's on this phone now` enables `Restore`; re-auth when app lock is on. Low free space (BKP-002): `There isn't room to keep a copy of this phone's data while restoring.` + a second checkbox `Restore without that copy`. |
| Passphrase field | Backup, restore | Enter + confirm, `Show` toggle (`Show passphrase, toggle`), plain strength hint (`Strong enough`), no-recovery line. Paste and password managers allowed (`autoComplete` `password-new` / `password`). Strength hint and `Passphrases don't match` are polite live regions with icon + text. A wrong passphrase keeps the field content. |
| Stepper | SCR-19 | `Step N of M` heading announced on each step; Back never loses input; Cancel anywhere writes nothing. |
| Charts | SCR-11/12, Home cards | Every chart has `View as table`: rows tappable with the same drill-down. Tap a bar/segment → filtered Activity. <2 comparable points: no trend direction (`No baseline yet`). **Net refund surplus:** when refunds exceed spending for a category or period, the amount is unsigned with `back` and the refund icon (`Shopping · ₹7,000 back`); the bar sits at zero with a `₹7,000 back` label. No minus signs, in the chart or its table. **TalkBack:** table rows are single nodes (`Food, 4,200 rupees, 32 percent`), the header row is announced as headers, scope label first (`Spent · HDFC only`). |

## State Patterns

Every screen's spec covers the PRD §6.4 state set: initial, loading, empty, populated, error, partial/import-review, permission-denied, read-only (where relevant), confirmation, success, offline (n/a: the app is always offline; no offline state is shown).

**Global patterns**

| State | Pattern |
|---|---|
| Loading | Skeleton shaped like the content (`{components.skeleton}`), then real values fade in 150–250ms. No spinners in the main app; long tasks use the coin loader (SCR-31). Stale/partial recompute is labelled, never animated as confirmed. |
| Empty | Small paper boat + one plain sentence + one primary action. Plan empty: three setup cards (`Add your rent` · `Set one budget` · `Name a goal`). |
| Error | Inline, never a dead end: plain cause + reassurance about data (`Nothing was saved`) + Retry + an alternative path (`Enter it by hand`, `Pick a photo instead`, `Open settings`). Announced (see Error retry). No modal OK-only dialogs. PRD §15 failure matrix applies. |
| Permission denied | Same inline pattern; the feature is off, other paths stay (`Enter it by hand`, `Open settings`). Camera, notification and SMS permissions are requested just in time only. |
| Unknown / not set | Never shown as zero: `+1 account not set`, `balance not set`, `Showing 3 bills you added`. |
| Confirmation | Reversible: act immediately + Undo toast. Irreversible or sensitive (erase, restore, decrypted export, lock change, delete permanently): explicit confirmation (checkbox row or confirm sheet with plain consequences) + re-auth when lock is on. No typed-word confirmations. |
| Success | Toast or inline line; relief moments (queue cleared, goal reached) get the boat. |
| Read-only | Safe mode (database can't open / fails integrity): no writes; offer restore, export and Diagnostics (SCR-22). |
| Amounts hidden | Every amount masked as `₹ ••••`; full rules in Privacy & Hidden Amounts. Illustrated in [mockups/key-home.html](mockups/key-home.html) (dark, amounts hidden). |
| Disabled | `button-primary-disabled` visual, `disabled` state announced, hint gives the reason. |

**Hero states (SCR-04)** — visuals in DESIGN.md › Components › Home hero card; under, over and hidden states illustrated in [mockups/key-home.html](mockups/key-home.html).

| Budget | Accounts | Hero shows |
|---|---|---|
| Overall budget (or 50/30/20) set, under | configured | `Left in budget` amount, bar, `<spent> of <budget>`, `~<left/days>/day · N days left`, In accounts · Card dues |
| set, under | not configured | same top; accounts line `Set up an account to calculate your balance` |
| set, **over** | either | warning icon + `Over budget` + unsigned amount; bar to limit tick + capped hatched overflow; `N days to payday` (days only); no nudge |
| none (or category budgets only) | configured | `Spent this period` + `Set a limit →` |
| none | not configured | `Spent this period` + `Set a limit →`; accounts line as above |
| 50/30/20 only, unclassified > 0 | either | adds `includes ₹X not classified · Sort it` |
| any | hidden amounts | label unchanged, `₹ ••••` masks, bar hidden, eye-slash |
| loading | — | skeleton |

**Per-surface specifics** (beyond the global patterns)

| Surface | Notable states |
|---|---|
| SCR-04 Home | Fresh install / no account / zero activity / needs review / overspent / hidden / corrupt datastore / background-resume per PRD Appendix B, with the overspent row overridden by the Hero states table above. SMS re-ask card (SMS-014) when eligible. |
| SCR-05 Home card editor | Default order; hidden cards listed with switch off; `Reset to default`. |
| SCR-07 Activity | Empty; filtered-empty (`No matches · Clear all`); 11 row states; Show rejected on/off; selection mode. Day headers refund-net (see Component Patterns › Activity row). Populated state with two filters: [mockups/key-activity.html](mockups/key-activity.html). |
| SCR-10 Review queue | Empty → boat + `You're all caught up · Smooth sailing`; duplicates with side-by-side evidence. |
| SCR-13 Plan | Empty → setup cards; Free to use gate-fail (`Set a limit →` / `Add an account →`) / short / pass. |
| SCR-16 Bills | Empty → `No bills yet. Rent, phone, subscriptions? · Add a bill`; upcoming / due soon (`Due in 2 days`) / paid (linked) / not seen yet after due date (never auto-marked paid). |
| SCR-17 Goals | Empty → `No goals yet. Saving for something? · Add a goal`; in progress; over-allocated (`This leaves you short by ₹X`, allowed); reached → boat. |
| SCR-18 Categories | Seeds with default `cat-*` colours; archive instead of delete when entries exist; colour picker shows only the 12 hues. |
| SCR-19 CSV wizard | Malformed rows (row-level errors, editable mapping); partial (resumable batch); summary imported/skipped/needs review. Cancel anywhere loses nothing. |
| SCR-20 Backup/restore | Wrong passphrase (nothing replaced, field kept, retry); newer-version backup refused with action; restore preview; low free space (restore without copy needs its own checkbox); success → Home. |
| Recently deleted (Settings › Data) | Empty → `Nothing deleted in the last 30 days`; entries with days left; Restore / Delete permanently (transfer legs go together). |
| SCR-22 Diagnostics | Status list (version, schema, storage, permissions, background state with OEM help); export shows a preview and needs consent. |
| SCR-23 Receipt review | Low-confidence total must be tapped to confirm; `date?` marker (warning icon + text) when unsure; not-itemised amount grey; match prompt. |
| SCR-24 SMS | Explainer; denied → manual / UPI / receipt remain; OEM help. |
| SCR-27 Capture sheet | Single / batch / credit types / transfer types / account discovery / unknown merchant / scam notice / new sender. Batch (with and without shared merchant): [mockups/key-capture-batch.html](mockups/key-capture-batch.html). |
| SCR-28 Learned merchants | Empty → `Nothing learned yet. Corrections you make with "Remember" show up here.`; mixed; blocked senders (India only). |
| SCR-29 Widget | Default (no amounts) / amounts-enabled / app lock on (no amounts) / N = 0 (no to-check text). |
| SCR-31 Loader | Progress, Cancel, failure → inline error pattern. |

## Interaction Primitives

- **Every gesture has a visible control.** Swipe-down on the capture sheet = `Later`; swipe between cards = `Previous` / `Skip`; long-press ＋ = `Snap receipt` chip and custom action; long-press category cell = chevron + `Choose subcategory`; long-press a row = `Select`; drag to reorder Home cards = `Move up` / `Move down`.
- **Sheets:** Add sheet, filter sheet, selection sheets and the capture sheet slide up over a `{colors.scrim}`. Content scrolls; actions sit in a sticky footer. Swipe down or Back dismisses. One sheet at a time; never a sheet over a sheet. Sheets trap focus until dismissed.
- **Swipe cards with auto-advance:** see Component Patterns › Swipe cards; the last decision closes the sheet with `All checked` + boat (the message stays 4s and is announced; under reduced motion it stays until tapped).
- **Undo toasts:** every reversible write (save, delete, reject, bulk recategorise, forget, unblock) shows one toast with Undo; durable paths listed under Toast. Rejected items stay under Show rejected (90 days); deleted manual entries under Recently deleted (30 days).
- **One-time tips:** see Component Patterns › Tooltip.
- **Haptics:** only when enabled, only on meaningful commits (save, approve).
- **Motion:** 150–250ms, never blocking input; no count-up. Reduced motion (system animator scale or in-app toggle): coin → still pie face; boat → still frame; OCR scan line → static photo + determinate progress bar; card change → instant swap + focus move; sheets and toasts → fade ≤150ms or none; hero values → instant.
- **Banned:** numeric badges (app icon, tabs, widget), "Inbox", spinners in the main app, modal OK-only dialogs, typed-word confirmations, upfront tutorials, blind Approve all, emoji, "coming soon", pull-to-refresh (nothing to fetch), gesture-only paths.

## Accessibility Floor

Behavioural rules. Contrast (all verified ratios): DESIGN.md › Colors.

- **Labels:** TalkBack label on every control with role and state. Amounts are read in full with direction (`Over budget, 2,340 rupees`; `Income, plus 85,000 rupees`). `~` is read `about`. Hidden amounts read `Amount hidden`. Tags are read as part of the row; merged-node order for hero and rows is in Component Patterns.
- **Large text (200%):** rules in DESIGN.md › Typography › Large text. Amounts are never truncated or wrapped mid-number; rows and sheets grow and scroll; heights are minimums; sticky footers keep Save / Approve / Reject reachable. **Tab bar** keeps all four labels and ＋ (labels capped at 1.3× then auto-fit; long-pressing a tab shows its full-size label as a tooltip). **Headers** split into two rows; text actions such as `Select` move into `More options`, so every action stays one visible control away. Illustrated in [mockups/key-activity.html](mockups/key-activity.html) (320dp × 200% frame). Test: 320dp × 200% × en-IN 9-digit amount × hidden and over-budget states, on the hero, Activity, Add sheet, capture sheet and widget.
- **Touch targets:** ≥ `{spacing.touch-min}` for every control, including inline links (48dp rows), filter chips (whole chip), segmented segments and widget buttons.
- **Focus:** visible focus ring (`{colors.focus-ring}` / `{colors.focus-ring-on-glass}`) on every focusable control for keyboard, D-pad and Switch Access. Focus order follows reading order. Scroll views keep the focused element clear of the tab bar and toast. After a sheet closes, focus returns to the control that opened it; Back always closes the top sheet.
- **Never colour alone:** overspend = icon + label + limit tick + hatch; row states = tag text (incl. `rejected`, `reversed`, `waiting`) with styling as a secondary cue; selection = filled icon shape or check; N/W/S = labels + patterns + gaps; category = icon + name.
- **Timing:** Undo toasts per Component Patterns › Toast. Auto-approve is stated on each capture and adjustable (time or Off) in Settings › Capture.
- **Announcements:** live regions for toasts, tips, split remainder, keypad amount, loader progress, filter results, passphrase hints; errors move focus to the field.
- **Charts:** every chart has `View as table`.
- **Reduced motion:** see Interaction Primitives › Motion. System animator scale 0 also switches glass to `{colors.glass-fallback}`.
- **Notifications:** actions carry full labels (`Approve ₹420 Swiggy`).

## Capture Surfaces outside the App

| Surface | Behaviour |
|---|---|
| Capture sheet (SCR-27) | Dialog-styled activity hosting a bottom sheet (60–70% height, full at large text, glass) over the dimmed host app; same structure as the Add sheet. Batch illustrated in [mockups/key-capture-batch.html](mockups/key-capture-batch.html). `Later` / swipe down = decide later. States `Adds itself at 9:00 pm unless you reject it` when auto-approve is on. Batch = swipe cards with `Previous` / `Skip` and focus-safe auto-advance; `Apply to all similar` for a shared merchant; last card → `All checked`. Credit types (CAP-004), transfer types (CAP-012), account discovery (CAP-009), bill match `Rent paid? Yes, link it` (CAP-011), `Not a transaction · Block sender`, `Remember for this merchant` (default on). Target open time ~400ms. |
| Share target | UPI success screenshot → capture sheet pre-filled. Locked → queued, delivered after unlock, never lost. India only. |
| Widget (SCR-29, 4×1; resizable 4×2) | 4×2 is the size to use at large text (buttons drop to their own row so nothing is lost). Default and app-lock-on: no amounts. Amounts enabled (and lock off): hero headline wording (`₹11,860 left` / `Over budget ₹2,340` / `Spent this period`). `N to check` text, hidden at 0. Snap / Add buttons (48dp, labelled `Snap receipt`, `Add entry`) pass LockGate. Follows the system theme. Renders only the snapshot written after each commit. |

## Notifications

| Type | Content | Tap |
|---|---|---|
| Capture | Full form: amount, merchant, account, guessed category + Approve / Reject (work from the shade; action labels name the entry, `Approve ₹420 Swiggy`). States `Adds itself at 9:00 pm unless you reject it` when auto-approve is on. The hidden form (`New payment to check`, a `Review` action only, unlock required) is used on the lock screen, when app lock is on, when hide amounts is on, or when the hidden form is chosen — unless full notifications are opted in (off by default). Several pending captures group into one updating notification. Lock-screen approve is opt-in, off by default. | Capture sheet (after unlock if hidden) |
| Evening summary | Collapsed `Today: N recorded · Tap to review`; expanded inbox-style up to 5 lines, merchant first: `Swiggy ₹420 · Food & Drinks` + `+N more`. Hidden form: count only. Sent only after the auto-approve write; at most one per day. | Activity filtered to today's auto-approved entries (after unlock) |
| Budget threshold | Once per threshold per period; neutral wording; never amounts on the lock screen | SCR-15 |
| Bill reminder | Bill reminders take priority over budget alerts; overflow merges into `N more reminders` (SET-003 caps) | SCR-16 |

No numeric app badge. Permission asked in context, never at onboarding; denied → in-app statuses still shown.

## Privacy & Hidden Amounts

- Hide-amounts eye on the hero masks every amount on every screen in one tap; remembered across launches; also forces hidden notification form and no widget amounts.
- **Mask:** every amount becomes currency symbol + a fixed four dots (`₹ ••••`); the length never changes, so it never leaks magnitude. Labels, signs (`+`), icons, tags, counts and days stay. The hero spent bar (and any bar or chart fill that encodes a money ratio) is hidden while masked, because its fill would reveal the ratio; layout does not shift. **Ratio text is hidden with it:** `85% used`, segment percentages and percent columns are not rendered or announced while masked; chart tables mask values. TalkBack reads each mask as `Amount hidden` (the dots are not read). Visual spec: DESIGN.md › Components › Amount mask.
- App lock (biometric / device credential), timeout on resume; app-switcher snapshot obscured.
- Widget shows no amounts by default; amounts only when enabled and app lock is off.
- Diagnostics export (SCR-22) only with preview and consent.
- Sensitive actions re-authenticate when lock is on (see State Patterns › Confirmation).

## Key Flows

FLOW-01–18 names and protagonists are taken verbatim from PRD §9; the PRD holds the full outline. Steps below add the UX beats. J-* journeys, defined in the memlog, cover surfaces with no PRD flow; protagonists are PRD §3.1 named personas.

### FLOW-01: Fresh installation (Mei, first-time tracker, Singapore)
1. Splash: coin half-flip, ends when the database is ready.
2. SCR-01 Welcome is the privacy screen: no sign-up, no internet, no bank login.
3. SCR-02: region and currency pre-filled from the device region (`Singapore · S$ SGD`) with live preview `Amounts look like S$1,234.50`; Continue in one tap; `Change` opens a searchable list (country or currency code, detected region pinned top); calm note that currency is fixed once entries exist.
4. SCR-03 one account: type, name, rough balance (`Rough is fine`), Skip.
5. Payday chip; optional `Try 50/30/20?`.
6. **Climax:** Home appears with her account and an honest hero (`Spent this period · Set a limit →`), no tutorial; a first-view tip explains In accounts.
Failure / alt: account skipped → accounts line `Set up an account to calculate your balance`. Back is safe at every step. App lock is offered once after her first saved entry.

### FLOW-02: Manual expense (Mei, first-time tracker, Singapore)
1. Taps ＋; Add sheet opens on Expense with keypad focused.
2. Types `12.50`.
3. Taps quick category `Food`; account pre-fills.
4. Taps Save (bottom-right).
5. **Climax:** sheet closes, toast `Saved · Undo`, hero and Activity already show it — about 6 seconds end to end.
Failure / alt: missing required field → inline error, focus moves to it, all input kept, nothing saved twice. `Save & add another` keeps the sheet open.

### FLOW-03: Income (Ravi, cash and mixed-mode user, Chennai)
1. ＋ → segmented control → Income (amount kept if already typed).
2. Amount, destination account, income category, Save.
3. **Climax:** Activity shows `+₹85,000` in income colour; the account balance and net cash flow update.
Failure / alt: inline validation; transfers and adjustments never counted as income.

### FLOW-04: Transfer and credit-card payment (Ravi, cash and mixed-mode user, Chennai)
1. ＋ → Transfer; categories give way to From → To pickers.
2. Picks accounts, amount, optional fee.
3. Confirms.
4. **Climax:** Activity shows one linked transfer row (transfer icon, unsigned, neutral); each account detail shows its leg; Insights spending unchanged except the fee.
Failure / alt: same account both sides → inline error; possible mismatch → warning, not a block (unless strict mode).

### FLOW-05: Search/edit/split (Ravi, cash and mixed-mode user, Chennai)
1. Activity → search or `Filters · N` chips (chip row: [mockups/key-activity.html](mockups/key-activity.html)).
2. Opens a row → SCR-08 → Split.
3. Adds rows; `Left to assign ₹X` counts down (announced); `Fill` takes the remainder.
4. **Climax:** Save enables only at exactly zero; Activity and charts refresh; toast with Undo.
Failure / alt: over-assignment `₹X too much`; Save stays disabled with its reason as a hint.

### FLOW-06: Budget (Arjun, budget-conscious salaried user, Pune)
1. Plan → Add budget → period, categories, target, thresholds.
2. Live progress on Plan (limit bars) and the Home hero (over-budget hero and Budgets card: [mockups/key-home.html](mockups/key-home.html)).
3. Threshold crossed → one notification per threshold per period.
4. **Climax:** tapping it opens SCR-15 with the contributing transactions filtered.
Failure / alt: notifications denied → statuses still visible in-app.

### FLOW-07: CSV import/reconciliation (Sara, privacy-focused professional, London)
1. Settings › Data › Import CSV → full-screen stepper `Step N of M` with Back.
2. File → mapping (auto-guessed, shown as a confirm screen; skipped when a saved bank format matches) → preview → duplicates (side-by-side evidence) → summary.
3. Nothing is written until `Import N entries`.
4. **Climax:** summary of imported / skipped / needs review, with a path to the Review queue; re-importing the same file adds nothing twice.
Failure / alt: malformed rows shown row by row with editable mapping; Cancel anywhere loses nothing; interrupted commit resumes.

### FLOW-08: Receipt OCR (Phase 1) (Mei, first-time tracker, Singapore)
1. ＋ `Snap receipt`, widget Snap, or long-press ＋ → camera (permission asked now, first time) or picker.
2. SCR-31 `Reading receipt…` with scan line (reduced motion: progress bar), `3 of 14 items`, `Cancel`.
3. SCR-23 review: merchant, date (`date?` if unsure), `Paid with` chip, category totals, `Not itemised` row (grey), `Items (N)` collapsed; low-confidence total tapped to confirm.
4. If a probable match exists: `Matches ₹2,340 HDFC debit 6:12 pm — Attach to it / Keep separate / Discard`.
5. **Climax:** `Save`; one entry with its receipt attached, totals reconciled to the cent.
Failure / alt: unreadable → `Couldn't read this receipt. Nothing was saved.` + `Try again` + `Enter it by hand`; camera denied → `Pick a photo instead`.

### FLOW-09: Android SMS (approved feature only) (Priya, busy digital spender, Bengaluru)
1. SCR-24 explainer (full screen): `Let wmbugo read bank SMS?`, rows Reads / Keeps / Never, `Turn on` → OS prompt, `Not now`, footer `Turn off anytime in Settings › Capture`, `Learn more` expands the field list.
2. A bank SMS arrives; capture notification (full or hidden form per SEC-005), grouped if several, stating `Adds itself at 9:00 pm unless you reject it`.
3. Approve / Reject from the shade, or tap → capture sheet (batch of several: swipe cards; see [mockups/key-capture-batch.html](mockups/key-capture-batch.html)).
4. Ignored eligible captures are written after the auto-approve time (`9:00 pm` in this example); evening summary follows.
5. **Climax:** her day is recorded with zero or one tap per payment, and Home's `N to check` disappears.
Failure / alt: denied → manual, UPI share and receipt remain; re-ask via Home card (J-SMS-REASK); blocked senders skipped; scam → `Looks like a scam — not added`; captures stop arriving because the OEM kills background work → Settings › Help › Diagnostics (SCR-22) shows the background state with OEM help text.

### FLOW-10: Backup & restore (Sara, privacy-focused professional, London)
1. Settings › Data › Backup → passphrase + confirm, Show toggle, `Strong enough`, `We can't recover this…`.
2. Pick target → export → success with a local-storage warning.
3. Restore → pick file → passphrase → SCR-31 verify.
4. Preview card: backup (date, entries, accounts) vs `This phone now`; `If something goes wrong during restore, nothing on this phone changes.`; `Back up this phone first` link.
5. Ticks `I understand this replaces what's on this phone now`; `Restore` enables; re-auth (app lock on).
6. **Climax:** integrity check passes and Home shows the restored numbers.
Failure / alt: wrong passphrase → nothing replaced, field kept, retry; newer-version backup → refused with what to do; low free space → second checkbox `Restore without that copy`.

### FLOW-11: Insight to source (Arjun, budget-conscious salaried user, Pune)
1. Insights → change period / account / category; labels state scope (`Spent · HDFC only`).
2. Taps a bar or segment → SCR-12 drill-down (or `View as table`).
3. Taps through to filtered Activity → SCR-08.
4. **Climax:** Back returns him to the same chart with the same filter and period.
Failure / alt: <2 comparable points → `No baseline yet`, no trend arrow. A category where refunds exceed spending shows `₹X back` with the refund icon, bar at zero.

### FLOW-12: Privacy lock (Sara, privacy-focused professional, London)
1. Settings › Privacy › App lock → OS auth confirmation; timeout set.
2. Leaves the app: app-switcher snapshot is obscured; notifications switch to hidden form; widget drops amounts.
3. Returns after timeout → LockGate → biometric or device credential.
4. **Climax:** she unlocks straight back to where she was; nothing sensitive was visible meanwhile.
Failure / alt: biometric fails → device credential fallback.

### FLOW-13: UPI screenshot share (India) (Priya, busy digital spender, Bengaluru)
1. Pays in GPay; shares the success screen to wmbugo.
2. Lock check (queued if locked, delivered after unlock).
3. Capture sheet pre-filled: amount, payee, time, UPI ref, `Paid from` chip (`+ New account` if unknown).
4. **Climax:** one tap on a category saves it; sharing the same screenshot again is recognised and adds nothing.
Failure / alt: dismissed without saving → kept as `Waiting for you`, never auto-approved; unreadable → `Enter it by hand`.

### FLOW-14: 50/30/20 budget (Arjun, budget-conscious salaried user, Pune)
1. Onboarding `Try 50/30/20?` or Plan › Budgets › Use 50/30/20.
2. Confirms the income figure (pre-filled from last full period when available).
3. Three targets created; Home and Plan show Needs / Wants / Savings bars (labelled, with values).
4. **Climax:** tapping a bar shows the categories of that type, then their transactions (Savings: money moved into savings pots).
Failure / alt: unclassified spending → hero note `includes ₹X not classified · Sort it`.

### FLOW-15: Account discovered from a capture (India) (Priya, busy digital spender, Bengaluru)
1. Capture from unknown ••7730 opens with `New account ••7730 (ICICI) — Add it / It's one of mine`.
2. `Add it`: type pre-selected from the SMS wording, changeable.
3. **Climax:** the account appears with its opening balance derived from the SMS (or `balance not set`) and the capture is saved to it.
Failure / alt: `It's one of mine` → pick an account; ••7730 is linked permanently. Until resolved the capture stays `Waiting for you`.

### FLOW-16: Own-account transfer from two captures (Priya, busy digital spender, Bengaluru)
1. Debit capture HDFC ₹5,000.
2. Credit capture ICICI ₹5,000 minutes later; the sheet offers `Moved from my own account` with HDFC pre-selected.
3. **Climax:** Save → one linked transfer row; neither leg counts as income or expense.
Failure / alt: auto-linked by mistake → `Not a transfer` undo.

### FLOW-17: Pay card bill (Arjun, budget-conscious salaried user, Pune)
1. Accounts → HDFC Card (Money you owe) → Pay card bill.
2. Add sheet opens as Transfer, From pre-chosen, To = card, amount = statement due or outstanding.
3. **Climax:** Save → card due drops, asset balance drops, spending unchanged.
Failure / alt: insufficient funds → warning, not a block.

### FLOW-18: Re-approve a rejected capture (Priya, busy digital spender, Bengaluru)
1. Activity → `Filters` → `Show rejected` (within 90 days).
2. Taps the row (`rejected` tag) → SCR-08 → `Restore`.
3. **Climax:** status becomes confirmed; balances and budgets update at once; toast with Undo.
Failure / alt: older than 90 days → purged; not shown.

### J-BILLS: Add rent as an upcoming bill (Arjun, budget-conscious salaried user, Pune)
Surfaces: SCR-13 Plan, SCR-16 Bills/recurring, bill reminder notification, SCR-27 capture sheet (bill match).
1. The day after payday Arjun opens Plan; the empty timeline shows the `Add upcoming bills` setup card.
2. Taps it → SCR-16 → `Add a bill`: Rent, ₹18,000, monthly, on the 5th, from HDFC.
3. Saves; toast with Undo.
4. **Climax:** the Plan timeline shows Rent before payday and Free to use drops by ₹18,000.
Later: a bill reminder arrives before the 5th (bill reminders take priority over budget alerts; SET-003 caps).
Later: a matching ₹18,000 debit capture asks `Rent paid? Yes, link it`; linking marks the bill paid for this period.
Failure / alt: with no included account, Free to use shows `Not enough information yet · Add an account →`; bills themselves never gate it. No matching debit by the due date → bill shows `Not seen yet` and is never marked paid automatically; `Mark as paid` and `Link an entry` stay available. Notifications denied → the timeline still shows due dates.

### J-GOAL: Save for a Goa trip (Arjun, budget-conscious salaried user, Pune)
Surfaces: SCR-13 Plan, SCR-17 Savings goals, limit bar.
1. Plan → Goals → empty state `No goals yet. Saving for something? · Add a goal`.
2. Creates `Goa trip`, ₹30,000, by March.
3. Taps `Set aside ₹5,000`.
4. **Climax:** Free to use drops by ₹5,000 while Left in budget and account balances stay unchanged; the goal card shows ₹5,000 of ₹30,000 with progress text.
Failure / alt: setting aside more than is free shows `This leaves you short by ₹X` (allowed, not blocked); Plan then shows `Short by ₹X` in neutral wording.

### J-FUEL: Split Fuel out of Transport (Ravi, cash and mixed-mode user, Chennai)
Surfaces: SCR-21 → SCR-18 Categories, SCR-07 Activity + selection mode (TXN-010), SCR-11 Insights.
1. Settings › Money › Categories → `Add category`: Fuel, fuel-pump icon, colour from the 12 hues, type Need.
2. Activity → filter merchant `HP Petrol`.
3. Long-presses a row (or taps `Select` in the toolbar) → selection mode.
4. `Select all` → `14 selected` → `Move 14 to…` → Fuel.
5. Preview: `Move 14 entries from Transport to Fuel. Amounts don't change.` → Confirm.
6. **Climax:** toast `Moved 14 to Fuel · Undo`; Insights shows Fuel as its own category.
Failure / alt: Undo puts all 14 back in one step; once the toast is gone, each entry can be recategorised from its detail screen. Back during selection exits with no change.

### J-LEARN: Fix a wrong guess and check what the app learned (Priya, busy digital spender, Bengaluru)
Surfaces: SCR-27 capture sheet, SCR-21 → SCR-28 Learned merchants & blocked senders.
1. Swiggy Instamart keeps landing in Food & Drinks.
2. On the next capture Priya picks Groceries with `Remember for this merchant` on; Approve (grid and Remember row: [mockups/key-capture-batch.html](mockups/key-capture-batch.html)).
3. Later: Settings › Capture › Learned merchants (row summary `32 merchants learned`).
4. Sees `Swiggy Instamart → Groceries` and, under Blocked senders, the promo sender she blocked last week.
5. **Climax:** the list matches what she taught; she trusts the guesses.
Failure / alt: `Forget` on a row → toast with Undo; the next capture from that merchant has no category pre-filled. `Unblock` restores a sender. A merchant marked `mixed` offers `Clear mixed`.

### J-HOMEEDIT: Move 50/30/20 above the fold (Arjun, budget-conscious salaried user, Pune)
Surfaces: SCR-04 Home, SCR-05 Home card editor.
1. Scrolls to the bottom of Home → `Edit Home`.
2. Drags Needs / Wants / Savings up under the hero (or uses `Move up`; TalkBack announces `moved to position 2 of 6`).
3. Switches off `7-day spend`.
4. Back.
5. **Climax:** Home opens with his two key answers, Left in budget and Needs / Wants / Savings, above the fold.
Failure / alt: the hero is pinned and has no Hide switch; `Reset to default` restores the original order.

### J-NOTIF: Hide notification details at work (Sara, privacy-focused professional, London)
Surfaces: lock screen capture notification, SCR-21 Settings (Privacy, Capture › Notifications).
1. A capture notification shows an amount on her lock screen during a meeting.
2. Settings: the Privacy row reads `App lock off · Amounts shown · Notifications: full`.
3. Privacy › Notification detail → Capture › Notifications: switches capture notifications to the hidden form; moves auto-approve to 22:00. Lock-screen approve stays off.
4. **Climax:** the next capture shows `New payment to check` with no amount or merchant.
Failure / alt: notifications permission off → the setting shows `Notifications are off for wmbugo · Open settings`; in-app statuses still work.

### J-RESTORE-DELETED: Bring back a deleted entry (Ravi, cash and mixed-mode user, Chennai)
Surfaces: SCR-07 Activity, SCR-21 → Settings › Data › Recently deleted.
1. Ravi deletes a ₹3,200 cash entry, thinking it was a duplicate; he misses the Undo toast.
2. A week later the cash balance looks wrong.
3. Settings › Data › `Recently deleted` → finds the entry (`23 days left`).
4. Taps `Restore`.
5. **Climax:** the entry is back with its original date; the cash balance updates.
Failure / alt: deleted more than 30 days ago → purged, not listed. `Delete permanently` on one leg of a transfer removes both legs after confirmation.

### J-SMS-REASK: Say yes to SMS later (Priya, busy digital spender, Bengaluru)
Surfaces: SCR-04 Home (re-ask setup card), SCR-24 SMS explainer, capture notification.
1. Priya tapped `Not now` on the SMS explainer at setup.
2. After her 5th manual entry Home shows a dismissible card `Tired of typing payments? Let wmbugo read bank SMS`.
3. Taps it → SCR-24 explainer → `Turn on` → OS prompt → Allow.
4. **Climax:** her next UPI payment arrives as a capture notification.
Failure / alt: dismissed → re-asks once more ≥7 days later, then only from Settings › Capture. OS permission denied → the explainer's denied state; manual, UPI share and receipt remain.

### J-EVENING: Catch a wrong auto-approved entry (Priya, busy digital spender, Bengaluru)
Surfaces: evening summary notification, LockGate, SCR-07 Activity (filtered), SCR-08.
1. 21:04: `Today: 6 recorded · Tap to review`.
2. Expands it and sees `Metro ₹60 · Food & Drinks`.
3. Taps → unlock → Activity filtered to today's auto-approved entries.
4. Opens Metro → changes to Transport with `Remember for this merchant` on.
5. **Climax:** fixed in two taps; tomorrow Metro lands in Transport automatically.
Failure / alt: app lock on or amounts hidden → the notification shows the count only; the list opens after unlock. A wrong entry can also be rejected from the same list, with Undo.

## Responsive & Platform

| Width | Behaviour |
|---|---|
| < 600dp (phones, incl. landscape) | Bottom tabs, single column, sheets from bottom |
| ≥ 600dp | Navigation rail replaces tabs (＋ at rail top); content centred at `{spacing.content-max}`; sheets centred at content width; no two-pane Activity/Detail (Phase 2). Keyboard and D-pad focus fully supported (focus rings). |

Glass falls back to `{colors.glass-fallback}` / `{colors.glass-fallback-dark}` below API 31, under battery saver, at animator scale 0, below the capability threshold, or over photo content. Android back gesture closes the top sheet first. Layouts respect display cutouts, gesture insets and the on-screen keyboard.

## Deviations from PRD

| PRD | Spine | Memlog ref |
|---|---|---|
| Appendix B SCR-04 Overspent: "negative Left in budget value"; §6.7 example "₹1,240 over budget · 4 days left" | Label flips to `Over budget`, amount unsigned with warning icon; time line shows days only; no minus signs anywhere | (override) Home hero overspent; (decision) overspent time line; (decision) Activity row direction |
| §6.2/§6.6 `glass.surface` = translucent white 18% | Deep-teal tinted glass in light mode too, 80% tint (verified ≥5.08:1); dark 62% floor, ≤45% gradient cap behind any dark glass | (override) Light-mode glass; (decision) Dark glass; A11y H2 |
| §6.2 / §6.6 `gradient.brand` on primary buttons | Primary buttons use only the #0F766E → #164E63 segment (white ≥5.47:1); ＋ keeps the full gradient (verified ≥3.90:1 under the icon) | Assumptions accepted (entry: gradient buttons use deep segment) |
| SET-001 optional accent themes | Teal only in Phase 1; Theme = System/Light/Dark | (override) Accent themes |
| SCR-18 category, FIN-010 account and GOAL-001 goal "icon/color" (free colour) | Colour picked only from 12 verified `cat-*` hues; seeds and account-type defaults pre-assigned | (decision) Category palette; (decision) Accounts and goals use the palette |
| Addendum §4 N/W/S teals (one set) | Dark-mode variants `needs-dark` / `wants-dark` / `savings-dark` (≥3.91:1) | Assumptions accepted (N/W/S dark variants) |
| 👁 / ⚠ glyphs; §6.2 icons unspecified | Phosphor library icons, no emoji | (decision) Icons |
| BDG-008 "missing inputs listed" when gate fails | Single next step naming the missing required input: `Not enough information yet · Set a limit →` or `· Add an account →`; bills and goals never gate | (decision) Free to use |
| Addendum §3 evening summary `Today: 6 recorded · 2 categories guessed · 1 to check [Review]` | Collapsed `Today: N recorded · Tap to review` + expanded list | (decision) Evening summary |
| BKP-002 pre-restore safety snapshot (behaviour unchanged) | Copy does not promise a lasting safety copy (AD-10 keeps it only until restart): `If something goes wrong during restore, nothing on this phone changes.` + `Back up this phone first` | (change) Restore copy |
| FLOW-10 "confirm" (unspecified) | Checkbox `I understand this replaces what's on this phone now` + re-auth; the earlier typed `RESTORE` pattern is removed | (change) A11y H6 |
| SEC-005 hidden form text "wmbugo · 1 new transaction" | `New payment to check` (still no amount, merchant or account; a `Review` action only) | (decision) J-NOTIF |
| §5.3 optional tablet two-pane | Deferred to Phase 2; rail + centred content only | (decision) Tablet |
| SCR-27 "floating" dialog | Bottom sheet inside the dialog-styled activity (consistent with CAP-002, AD-12) | (decision) Capture dialog |
| §5.1 Settings › Money holds SCR-28 Learned merchants & blocked senders | SCR-28 lives under Settings › Capture (it is about capture guessing and SMS senders); Money holds Categories only | (override) Learned merchants & blocked senders |
| TXN-006 day headers "Spent" (gross wording) | Day-header Spent is refund-net: confirmed expenses minus refunds received that day, floored at ₹0; transfers, income, pending, reversed and rejected excluded (consistent with FIN-028 / BDG-006) | (override) Activity day-header Spent |

## Open Questions

No open UX questions. Two build-phase items remain; neither blocks the UX spec:

1. **Coin-flip Lottie and reduced-motion still frames** (GATE-12 assets). Build-phase asset work.
2. **Widget library** (spike). Build-phase technical spike; the widget's content and layout are fixed above.

**PRD follow-up edits** (not UX questions): the PRD needs edits matching the overspent wording, light glass, primary-button gradient, accent themes, category colour, restore copy, Learned merchants location and day-header Spent rows in Deviations from PRD.
