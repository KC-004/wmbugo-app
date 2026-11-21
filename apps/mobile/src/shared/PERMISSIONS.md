# Permissions

wmbugo asks for as little as it can. The release build declares no `INTERNET` and no `ACCESS_NETWORK_STATE` permission, so it cannot send anything anywhere. Every permission that may ever be on the release allowlist (`scripts/android-permission-allowlist.json`) has a row below; a CI test fails when one has none. Every runtime request goes through the single `requestPermission(kind)` helper in `src/adapters/permissions.ts`, and none is requested during onboarding (spy test in `onboarding.test.tsx`).

| Permission | Kind | Feature that needs it | In-context rationale (shown before the system prompt) | What still works when denied | Revocation in Android settings |
| --- | --- | --- | --- | --- | --- |
| `POST_NOTIFICATIONS` | `notifications` | Budget alerts (Story 4.9) and bill reminders (Story 6.5) | Asked once, just in time: `Want a heads-up before a bill is due?` / `Get a nudge when a budget is nearly used?` Notifications never carry an amount. | Everything. Settings are kept; nothing is scheduled or posted. Bills and budgets show `Notifications are off for wmbugo` with `Open settings`. | Read again each time the app comes back to the foreground (no restart, no prompt, no crash): the screens re-read the state and show the denied wording. Reminders are scheduled again when it is granted. |
| `<applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | none | Added by AndroidX so only wmbugo can receive its own dynamically registered broadcasts | Never shown: it is not a runtime permission and has no prompt. | Not applicable. | Not applicable: it cannot be revoked. |

## Notes

- Permissions listed here but not yet declared in the manifest (the notification adapter is not installed yet) are documented ahead of time so the row exists when the adapter arrives.
- Android backup and phone-to-phone transfer exclude all wmbugo data (`allowBackup=false` and data-extraction rules).
- Files the user saves (backups, CSV and diagnostics exports) leave wmbugo's control; where they are put decides who can reach them. Backups stay encrypted with the passphrase.
