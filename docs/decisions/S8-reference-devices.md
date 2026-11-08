# S8 — Reference devices and benchmark method

Status: **interim, GATE-03 not signed** (decided 2026-11-08, Story 1.3). All benchmark results taken before sign-off are provisional.

## 1. Reference devices

The assumption "developer's phone + one budget phone on Android 8–10" is **confirmed in shape, with an interim budget device**.

| Role | Device | Android / API | SoC | RAM | Display | Status |
|------|--------|---------------|-----|-----|---------|--------|
| Main (mid-range) | Xiaomi Redmi Note 11 Pro+ 5G (`2201116SI`, codename `peux`) | 13 / 33 | Qualcomm SM6375 (Snapdragon 695) | 6 GB (5.3 GB usable) | 1080×2400, 60/120 Hz | Real device, read over adb on 2026-11-08 |
| Budget (interim) | Android emulator, Pixel-class image, Android 9 | 9 / 28 | host x86_64, 2 cores | 2 GB | 1080×1920, 60 Hz | Interim stand-in; **not a valid timing device** |

Rules for the interim budget device:
- The emulator proves behaviour that depends on API level (glass fallback below API 31, permissions, first-launch flow). It does **not** produce valid timings: host CPU and GPU make its numbers meaningless for NFR-03/04/05/06/19/20.
- Until a real budget phone (Android 8–10, ≤3 GB RAM, entry SoC) is named here, performance acceptance criteria are judged on the main device only and are provisional.
- Replacing the emulator with a real device does not change the method below; it only adds a row to the table and a run set.

## 2. Sign-off (GATE-03)

Product owner sign-off: **pending**.

Interim devices used: the two rows above. Benchmark results are provisional until the product owner signs here with name and date: `Signed: ____ / ____`.

## 3. Method (applies to every device)

Common conditions: release build of the `nosms` flavor (bundled JS, Hermes, no Metro, no debugger); airplane mode on; battery saver off; battery ≥ 50% (record whether charging); screen brightness fixed; no other foreground apps; device idle 60 s before a run set; thermal state checked (`adb shell dumpsys thermalservice`) and a run set discarded and repeated if throttled. Refresh rate is fixed to 60 Hz for NFR-06/19 frame metrics; 120 Hz is reported separately and never substituted. Each run set records device, build hash, data set and date.

Data sets (created by a seed script in a later story, same seed every time): **S0** empty profile; **S1k** 1,000 entries; **S10k** 10,000 entries over 24 months; **S50k** 50,000 entries (stress only).

Definitions:
- **Cold start**: process not running (`am force-stop`), launched by `adb shell am start -W`. **Warm start**: process alive in background, brought forward. Home-ready = first frame after the Home queries resolve, marked in-app (`performance.mark`) and cross-checked against `am start -W` `TotalTime`.
- **Runs**: median metrics (NFR-03) use 30 runs; p95 metrics (NFR-04, NFR-05, NFR-20) use 50 runs (p95 of fewer than about 40 samples is not meaningful). The first 3 runs are warm-up and are discarded; the report states how many were discarded.

| NFR | Metric | Data set | Tool | Runs | Pass rule |
|-----|--------|----------|------|------|-----------|
| NFR-03 | Median tab navigation (tap to first stable frame of target tab) | S10k | In-app marks (tap handler to first frame after render), cross-checked with Perfetto | 30 per tab pair | median < 300 ms |
| NFR-04 | Manual-entry Save, validation done to confirmation visible | S10k | In-app marks around `RecordManualEntry` to toast shown | 50 | p95 < 500 ms |
| NFR-05 | Warm start to Home visible | S10k | `am start -W` plus Home-ready mark | 50 | p95 < 2 s |
| NFR-06 | UI frames during animations and list flings; no OCR/analytics on the UI thread | S10k | `dumpsys gfxinfo <pkg> framestats` over scripted `input swipe` flings; Perfetto for the thread check | 10 scripted flings, 3 sets | ≥ 95% of frames within 16.7 ms and no frame > 100 ms |
| NFR-19 | Same frame metric while scrolling a glass surface | S10k | as NFR-06, glass on | 10 flings, 3 sets | ≥ 95% at 60 FPS, no stall > 100 ms; otherwise the device uses `glass-fallback` |
| NFR-20 | Splash time added before Home, ending on DB ready | S10k | cold `am start -W` minus a no-splash control build, plus a DB-ready mark | 50 | p95 added ≤ 1 s, Home within the NFR-05 budget; splash never ends on a timer |

Results are reported as median, p95, worst, run count and discarded count, in a table per device. A failed rule on the main device blocks the story under test; a failure on the interim emulator does not.

## 4. Glass capability threshold (UX-DR4)

`glass-fallback` is used when **any** of these holds (UX-DR4's other conditions — battery saver, animator scale 0, reduce transparency, photo/receipt imagery — still apply):

1. API level < 31.
2. Total RAM < 4 GB (`ActivityManager.MemoryInfo.totalMem`), the static capability rule.
3. Measured rule: the device's glass scroll set (NFR-19 row) fails its pass rule. Glass does not exist yet, so this rule cannot be measured today; Story 1.8 builds the first glass surface and the measurement, and revisits this rule then.

| Device | API rule | RAM rule | Result |
|--------|----------|----------|--------|
| Redmi Note 11 Pro+ 5G | 33 ≥ 31 passes | 6 GB ≥ 4 GB passes | Glass **on**, pending the measured rule |
| Android 9 emulator | 28 < 31 fails | 2 GB < 4 GB fails | `glass-fallback` |

The static values (API 31, 4 GB) are decided now so Stories 1.6, 1.8 and 1.10 can code against them; the measured rule can only tighten the result, never loosen it.

## 5. Affected stories and open item

1.6 (splash, NFR-20), 1.8 (glass rule and measured threshold), 1.10 (navigation, NFR-03), 1.13 (Save, NFR-04), 1.14 (Home, NFR-05), and every later epic's performance criteria.

Open item: name a real budget phone and sign GATE-03.
