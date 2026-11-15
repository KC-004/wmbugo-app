---
title: 'Story 6.5: Bill reminders with a just-in-time permission ask'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: 'f334b07'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-6-context.md'
---

## Intent

**Problem:** Bills can be tracked but nothing reminds the user before one is due.

**Approach:** Migration 0023 adds `remind_days` (null Off, 0, 1, 3; new bills default to 1). Pure `planBillReminders` plans the next 14 days at 09:00 local with at most three notifications a day (two individual plus one `N more reminders`); `reminderContent` carries no amount and a generic lock screen. The Notifier port gains `replaceScheduled`, and `syncBillReminders` makes the scheduled set exactly the planned one (idempotent), on `RecurringChanged`, `TransactionsChanged`, `ProfileChanged`, app start and resume. A bill saved with a reminder on asks once for the permission; a denied permission keeps the setting and shows `Open settings`. A tapped reminder opens Bills scrolled to that bill. Budget alerts fold into the day's overflow notification when bill reminders hold the slots.

## Decisions

- The real notification library is still not installed, so `appNotifier` is `unavailableNotifier`: scheduling is a no-op on device until the adapter lands (it implements `replaceScheduled` then). The planning, ask and fold logic run and are tested through a fake notifier.
- `localToInstant` and `localMinutesOfDay` live in the clock module so planning code stays free of date arithmetic.
- The permission ask is recorded in `prompt_state` (`bills.reminder-ask`) and never repeated; a granted budget ask means permission is already granted and no ask is shown.
- App lock re-authentication on tap belongs to Epic 8.

## Verification

- `billReminders.test.ts` (time zones and daylight saving, planning rules and window, the 9:00 cutoff, the three-a-day cap, content without amounts, idempotent sync, permission and notifier gates, edit keeps the setting, fold of a budget alert) and the reminder block in `bills.test.tsx` (chips, default, caption, ask once, Not now, Off asks nothing, notifications-off inline).
