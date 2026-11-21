---
title: 'Story 8.5: Notification privacy: hidden form and notification detail'
type: feature
created: '2026-11-21'
status: in-review
route: dispatch
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Notifications decide their own content, so amounts could show on a locked phone or in a meeting.

**Approach:** A pure core function `decideNotificationForm` picks the hidden or full form from notification detail, app lock, hide amounts and an opt-in; every notification passes through it; Settings gets a Notification detail screen.

## Boundaries & Constraints

**Always:** hidden capture notifications say `New payment to check` with no amount, merchant, account or category and only `Review`; the lock-screen form of a capture is hidden unless `lockScreenApprove` is true.

**Never:** no new notification content is built here for captures beyond the hidden template (Epic 11 owns the full capture card).

</frozen-after-approval>

## Tasks & Acceptance

- [x] core `notificationPrivacy.ts` -- `decideNotificationForm`, `effectiveCaptureForm`, `widgetMayShowAmounts`, `hiddenCaptureNotification`, `withShadeForm`, `withNotificationPrivacy` (a Notifier that applies the form and re-posts)
- [x] core settings -- `privacy.notification_detail`, `privacy.full_notifications_opt_in`, `SetNotificationPrivacy` (audit and `ProfileChanged`; refused through `ChangeSetting`)
- [x] mobile -- `appNotifier` wrapped with the privacy form, reader injected from `startApp`, `ProfileChanged` re-post handler, debug fixture trigger file `post-capture-fixture`
- [x] Settings -- `Notification detail` page (radios, opt-in switch, caption, off-state with Open settings); the Privacy summary now ends `Notifications: full|hidden`
- [x] tests: core matrix (32 cases) and wrapper, settings screen, notifier wiring

## Implementation Notes

- **No migration:** `settings` is a key/value table, so the two new keys need no schema change; the story text asked for one, which would add nothing.
- A capture notification never reaches the notifier until Epic 11, so the hidden template and the form matrix are what ship now. Tapping `Review` opening through LockGate is delivered by Story 8.3's pending-intent queue once a notification adapter calls `deliverIntent`.
- Re-posting after a settings change covers notifications posted in this process (kept in memory); after a process restart the adapter will need to read its active notifications. Scheduled bill reminders are rebuilt by their own `ProfileChanged` sync, which now goes through the form.
- The debug fixture posts nothing today because the notification library is not installed (`unavailableNotifier`); it is in place for the adapter story.
- Checks: lint and typecheck clean, core 946 tests, mobile 2,342 tests.
