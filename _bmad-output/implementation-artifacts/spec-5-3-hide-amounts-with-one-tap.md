---
title: 'Story 5.3: Hide amounts with one tap'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_commit: '4e6a7e9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The hero eye toggles a local flag only. Nothing masks the rest of the app, the choice is lost when the app closes, and spoken labels would still read amounts.

**Approach:** One persistent `hide_amounts` profile setting (`SetHideAmounts`, audit + `ProfileChanged`) mirrored by one store that `<Amount>`, money-in-sentences and every TalkBack label read. The eye flips it in the same frame, announces politely and saves; the app starts masked when the setting is on.

## Boundaries & Constraints

**Always:** Masked amount = currency symbol + exactly four dots in the same role, weight and colour; direction cues stay (`+₹ ••••`); the dots are hidden from TalkBack and the node reads `Amount hidden`. Bars, fills and any percentage derived from money are not drawn or spoken (track space and counts, days, labels, signs and icons stay). Money inside status text is masked. The Add sheet keypad still shows what is typed. Budget notifications keep their amount-free wording. Only `<Amount>`, `moneyText` and the label helpers format money, so no screen can bypass the mask.

**Never:** A new migration (settings is a key-value table). Settings › Privacy UI (Epic 8 binds the same setting). Masking the sample amount in Settings number-format preview and onboarding (they are not the user's data).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Toggle on | tap the eye | every amount on every screen masks in the same frame; eye-slash; `Amounts hidden` announced politely | save fails: mask reverts |
| Toggle off | tap again | amounts return; `Amounts shown` | same |
| Reopen | force close, reopen | still masked from the first frame | corrupt value reads as off |
| Width | ₹60 and ₹1,18,60,000 | identical masked text and style | N/A |
| Direction | income | `+₹ ••••` in the income colour | N/A |
| Hero | masked | label unchanged; amounts, caption, daily line, accounts masked; bar, tick and overflow absent, track kept; label reads `amount hidden` per figure | N/A |
| Ratios | limit bar, 85% used | no fill, no percent; days stay | N/A |
| Audit | masked, every built screen | no digit-bearing money string, no money `%`, no money in any TalkBack label | N/A |

</frozen-after-approval>

## Code Map

- `packages/core/src/profile/settings.ts`, `settingsCommands.ts` -- `ui.hide_amounts`, `hideAmounts`, `SetHideAmounts`.
- `apps/mobile/src/shared/state/amountsHidden.ts` (new) -- the store, `useAmountsHidden`, `isAmountsHidden`.
- `apps/mobile/src/shared/ui/Amount.tsx`, `moneyText.ts`, `LimitBar.tsx`, `shared/a11y/labels.ts` -- read the flag by default; an explicit `hidden` wins.
- `apps/mobile/src/features/settings/SettingsBridge.tsx`, `settingsApi.ts` -- fill the store before the first frame; `setHideAmounts`.
- `apps/mobile/src/features/home/useHideAmounts.ts`, `HomeScreen.tsx` -- the eye.
- Components that build amount text or labels subscribe with `useAmountsHidden()`: Accounts, Account detail, Archived, CardLines, Activity row and day header, Split sheet, Entry detail, Budgets, IncomeCard.
- `apps/mobile/src/shared/moneyLeaks.testkit.ts` -- the audit helper.

## Tasks & Acceptance

**Execution:**
- [x] core: setting, validation, `SetHideAmounts`, tests (audit, `ProfileChanged`, strict boolean, corrupt value)
- [x] store, `Amount`, `moneyText`, `LimitBar`, labels read the flag; subscribers added
- [x] SettingsBridge + `setHideAmounts`; the eye toggles, announces, saves and reverts on failure
- [x] tests: mask, width, direction cue, label, explicit override, live flip, persistence, hero states, per-screen audit

**Acceptance Criteria:**
- Given the matrix, when Hide amounts is on, then no built screen shows or speaks a money value or a money percentage.
- Given core and mobile suites, typecheck and lint, then all pass.

## Implementation Notes

Implemented directly. No migration: `ui.hide_amounts` is a JSON setting like the others. The mask is a mirror store, not a React context, so plain functions (labels, `moneyText`) can read it; every component that builds such text also subscribes so it re-renders on a toggle. The Settings number-format preview and the onboarding sample pass `hidden={false}` because they are samples, not the user's money. The audit covers Home, Activity rows, entry detail, review queue, accounts list and detail, budgets list (with Needs, Wants, Savings and Not classified) and budget detail; Categories shows no amounts of its own beyond `<Amount>`.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Route |
|---|---|---|
| Revert after a failed save overwrote a newer tap; failed save not announced (blind, edge, gap) | medium | patched: revert only our own change, announce the state the screen goes back to; tests for failure, rejection and two quick taps |
| Settings load failure left amounts showing (blind, edge) | medium | patched: fail closed (hidden) when the saved choice cannot be read; test |
| Toggle write left the settings cache stale (blind, edge) | low | patched: cache updated on a successful save |
| HeroCard and HeroBar defaulted hidden to false and could bypass the flag (edge) | medium | patched: default to the flag |
| Components that build labels with plain functions were only tested mounted already masked (gap) | high | patched: hide-after-mount tests for rows (11 states), accounts, detail, Activity, queue, entry, budgets |
| Money detector missed suffix and code currencies (blind, edge, gap); found two real leaks: the foreign amount in a row label and in the review card | medium | patched: stronger detector, `foreignMoneyText`, both leaks fixed |
| Weak hero assertion (track count 0 or 1) (blind, edge, gap) | low | patched: exact count per state |
| Settings preview and onboarding opt-outs untested; AddSheet balances not audited; two write paths for one key; boilerplate and import order | low | deferred or rejected: samples are not the user's money, same validation on both paths |

## Verification

**Commands:**
- `cd packages/core && npx tsc -p tsconfig.json --noEmit && npx jest`
- `cd apps/mobile && npx tsc --noEmit && npx jest`
- `npx eslint --max-warnings 0 apps/mobile/src packages/core/src/profile`
