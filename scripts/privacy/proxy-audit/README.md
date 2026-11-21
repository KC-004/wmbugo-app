# Proxy audit: wmbugo sends nothing

Proves that a release build makes zero network requests from `app.wmbugo` while the main flows run. The build has no
`INTERNET` permission, so zero is also what Android should enforce; this runbook checks the claim from the outside with
an intercepting proxy. It is re-run in Epic 14 for every flow, and before each release.

This runbook is a manual procedure (an emulator and a proxy are needed). Record each run in `RESULTS.md` next to this
file: date, build, emulator image, flows driven, number of requests recorded from `app.wmbugo`.

## Setup

1. Build the release APK: `cd apps/mobile/android && ./gradlew assembleNosmsRelease` (use a debuggable release only if you
   need `run-as`; the debuggable flag does not add network permission).
2. Start an emulator (API 34 recommended) and a proxy that records every request and can run in transparent mode, for
   example `mitmproxy --mode transparent` or Charles with the emulator's `-http-proxy http://10.0.2.2:8080`.
3. Install the proxy's CA on the emulator so TLS traffic can be read. Also capture a packet trace for raw traffic:
   `adb shell tcpdump -i any -w /sdcard/wmbugo.pcap` (rooted emulator image) or run the emulator with `-tcpdump wmbugo.pcap`.
4. Note the app's UID: `adb shell dumpsys package app.wmbugo | findstr userId`.
5. Check the declared permissions: `adb shell dumpsys package app.wmbugo | findstr INTERNET` must print nothing.

## Flows to drive

1. First launch and onboarding (region, account, payday, budget), skipping nothing.
2. Add an expense, an income and a transfer; undo one.
3. Create a budget, cross a threshold, open its detail.
4. Add a bill, mark it paid, link a payment.
5. Open Activity, search, open a detail, attach a receipt photo (when available).
6. Open Insights and a drill-down; export a CSV to the save dialog.
7. Settings: Privacy, Hide amounts, Diagnostics (when Story 8.10 lands).

## Pass criteria

- The proxy records **0 requests** attributed to `app.wmbugo` for the whole run. Requests from other apps and the system
  (Play services, time sync) are ignored; attribute by UID or by the packet trace's source.
- The packet trace shows no connection opened by the app's UID.
- Attach the proxy log and the permission check output to the release notes.

## If a request appears

Stop. It is a release blocker. Find the library that made it (`adb logcat -s wmbugo`, the dependency report from
`pnpm check:denylist`), remove it, and rerun the whole runbook.
