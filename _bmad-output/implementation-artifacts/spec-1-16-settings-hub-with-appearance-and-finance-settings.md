---
title: 'Story 1.16 - Settings hub with appearance and finance settings'
type: 'feature'
created: '2026-11-08'
status: 'done'
route: 'oneshot'
baseline_commit: '2cec6af'
---

## Intent

Implements the epic's Story 1.16 acceptance criteria (see epics.md).

## Implementation Notes

- Core `profile/settings.ts`: typed settings with defaults and per-key validation (theme, number format, haptics, reduce motion, default period, first day of the week, default account, block transfers), `effectiveLocale` (a chosen number format overrides the region's locale), `periodRule`, and the live `youSummary` ("Payday 1st · Dark").
- Core use cases: `ChangeSetting` (validated, the audit row holds the key never the value, raises `ProfileChanged`), `ChangeProfile` (region and currency, payday, timezone; a currency change is refused with `CURRENCY_LOCKED` once any transaction exists and nothing changes; no transaction is ever modified), and the timezone prompt trio `TrackTimezone` (remembers when the device zone started to differ by 2 hours or more), `AnswerTimezonePrompt` (recorded once in `prompt_state`; Yes stores a pending switch from the next local day), `ApplyPendingTimezone` (switches the profile zone when that day arrives; existing `local_date` values stay).
- Mobile: `SettingsScreen` (hub with only the You group and its summary in the spoken label; You > Appearance, Money basics, and the Block transfers above the balance switch; Android Back steps up a level), `SettingsBridge` (applies the saved theme and the in-app Reduce motion to the whole app, no restart; waits for the first read so the saved theme is on the first frame, and opens with defaults if the read fails). Home shows the once-only time zone prompt as a card with Yes and No.
- Amounts everywhere use the chosen number format: Home, Activity, Add and Accounts read the effective locale. Home's period follows the default-period setting and the payday. The default account is a fallback in the Add sheet after the category and recent-use rules.
- The Block transfers switch is read by `RecordTransfer` and by the Add sheet warning (Story 1.15's shared key).

## Not done / open

- Haptics is stored and shown but nothing vibrates yet (no haptic feedback exists in the app to switch off).
- First day of the week is stored; no screen uses it until calendars and weekly insights exist.
- Text scaling follows the system setting (Story 1.9 caps); there is no in-app text-size control.
- Reduce motion is applied to sheets and toasts through the shared hook; the still brand frames for it are not re-verified in this story.
- The time zone switch could not be tested across a real day change on the device; it is covered by tests with a fake clock.
- Settings groups beyond You are intentionally absent until their features exist.

## Verified on the Redmi

- Opened Settings from the profile icon, changed the theme to Light and the number format, and changed the payday; each applied at once without a restart and the You summary updated.
