#!/usr/bin/env bash
# Installs the debuggable release APK, launches it once, pulls the database and checks its header.
set -euo pipefail
adb install -r apps/mobile/android/app/build/outputs/apk/nosms/release/app-nosms-release.apk
adb shell am start -W -n app.wmbugo/.MainActivity
for i in $(seq 1 30); do
  if adb shell run-as app.wmbugo test -s databases/wmbugo.db; then break; fi
  sleep 2
done
adb exec-out run-as app.wmbugo cat databases/wmbugo.db > /tmp/wmbugo.db
node scripts/check-encrypted-db.mjs /tmp/wmbugo.db
