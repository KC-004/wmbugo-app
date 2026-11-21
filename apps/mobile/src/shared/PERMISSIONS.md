# Permissions

wmbugo asks for as little as it can. The release build declares no `INTERNET` and no `ACCESS_NETWORK_STATE` permission, so it cannot send anything anywhere. Every permission that may ever be on the release allowlist (`scripts/android-permission-allowlist.json`) has a row below; a CI test fails when one has none. Every runtime request goes through the single `requestPermission(kind)` helper in `src/adapters/permissions.ts`, and none is requested during onboarding (spy test in `onboarding.test.tsx`).

| Permission | Kind | Feature that needs it | In-context rationale (shown before the system prompt) | What still works when denied | Revocation in Android settings |
| --- | --- | --- | --- | --- | --- |
| `POST_NOTIFICATIONS` | `notifications` | Budget alerts (Story 4.9) and bill reminders (Story 6.5) | Asked once, just in time: `Want a heads-up before a bill is due?` / `Get a nudge when a budget is nearly used?` Notifications never carry an amount. | Everything. Settings are kept; nothing is scheduled or posted. Bills and budgets show `Notifications are off for wmbugo` with `Open settings`. | Read again each time the app comes back to the foreground (no restart, no prompt, no crash): the screens re-read the state and show the denied wording. Reminders are scheduled again when it is granted. |
| `USE_BIOMETRIC` | none (declared in the manifest; the system prompt needs no runtime request) | App lock (Story 8.3) and the `Confirm it's you` re-authentication: the system BiometricPrompt, a strong biometric or the device credential | Asked in context: the prompt is titled `Turn on app lock`, `Unlock wmbugo` or `Confirm it's you`. Nothing is requested at install or during onboarding. | App lock simply stays off. A phone with no screen lock shows `Set a screen lock on your phone first.` with `Open settings`. wmbugo is fully usable without app lock. | If the screen lock is removed after app lock was turned on, LockGate says it cannot ask the phone and offers `Open settings`; the data key is not tied to biometrics, so nothing is lost (AD-9). `USE_FINGERPRINT` is deliberately not declared, so on Android 8 and 9 the device credential is offered instead of the fingerprint. |
| `<applicationId>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | none | Added by AndroidX so only wmbugo can receive its own dynamically registered broadcasts | Never shown: it is not a runtime permission and has no prompt. | Not applicable. | Not applicable: it cannot be revoked. |

## Notes

- Permissions listed here but not yet declared in the manifest (the notification adapter is not installed yet) are documented ahead of time so the row exists when the adapter arrives.
- Android backup and phone-to-phone transfer exclude all wmbugo data (`allowBackup=false` and data-extraction rules).
- Files the user saves (backups, CSV and diagnostics exports) leave wmbugo's control; where they are put decides who can reach them. Backups stay encrypted with the passphrase.

## Backups and export files leave wmbugo's control (Story 8.7, BKP-006, BKP-007)

- **Android's own backup does not include wmbugo.** `allowBackup="false"` plus `backup_rules.xml` (Android 11 and earlier) and `data_extraction_rules.xml` (Android 12 and later, cloud backup and phone-to-phone transfer) exclude the database, photos, logs, staging and keys. A static test in `os-backup.test.ts` fails if any of that changes. The on-device check (`adb shell bmgr backupnow app.wmbugo` and a device-to-device transfer, then looking for the database, photos, logs and keys) belongs to the release checklist.
- **A backup the person saves is theirs to place.** Backup, CSV and diagnostics files are written through Android's save dialog (Storage Access Framework, no permission) to the place the person chose. Saved to a cloud folder, a file leaves the phone: it is still encrypted with the passphrase (a backup) or contains only what the person previewed (diagnostics), but where it goes decides who can reach it. wmbugo never keeps a copy.
- **No permission is needed** to make or restore a backup: the save dialog and file picker hand over one document.
