#!/usr/bin/env node
// Fails if an analytics, crash-reporting, ads, attribution or network SDK is among the dependencies (Story 8.1, SEC-002).
//
// Usage:
//   node scripts/check-dependency-denylist.mjs                # pnpm-lock.yaml plus any Gradle dependency reports found
//   node scripts/check-dependency-denylist.mjs <file> [...]   # the given lockfile(s) / Gradle `dependencies` report(s)
//
// CI writes the resolved release classpaths first:
//   ./gradlew :app:dependencies --configuration nosmsReleaseRuntimeClasspath > apps/mobile/android/app/build/reports/dependencies-nosms.txt
//   ./gradlew :app:dependencies --configuration smsReleaseRuntimeClasspath   > apps/mobile/android/app/build/reports/dependencies-sms.txt
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** [label, test on a package name (`group:artifact` for Gradle, `name` or `@scope/name` for npm)] */
export const DENYLIST = [
  ['Firebase', (n) => /firebase/i.test(n)],
  ['Crashlytics', (n) => /crashlytics/i.test(n)],
  ['Google Analytics / play-services-measurement', (n) => /play-services-(measurement|analytics|ads|appset)|firebase-analytics|google-analytics/i.test(n)],
  ['datatransport', (n) => /datatransport/i.test(n)],
  ['Sentry', (n) => /(^|[:/@])sentry/i.test(n)],
  ['Bugsnag', (n) => /bugsnag/i.test(n)],
  ['AppsFlyer', (n) => /appsflyer/i.test(n)],
  ['Adjust', (n) => /(^com\.adjust|adjust-android|react-native-adjust|@adjustcom)/i.test(n)],
  ['Facebook SDK', (n) => /(^com\.facebook\.android[:]|facebook-android-sdk|react-native-fbsdk|^com\.facebook\.(?:appevents|stetho)[:])/i.test(n)],
  ['Mixpanel / Amplitude / Segment / PostHog', (n) => /(mixpanel|amplitude|segmentio|analytics-react-native|posthog)/i.test(n)],
  ['Flurry / OneSignal / AppCenter / Datadog', (n) => /(flurry|onesignal|appcenter|datadog)/i.test(n)],
];

/** Pulls package names out of a pnpm lockfile (v9 keys) or a Gradle dependency report. */
export function packageNames(text) {
  const names = new Set();
  for (const line of text.split(/\r?\n/)) {
    // pnpm lockfile: "  '@sentry/react-native@5.0.0':" or "  react-native@0.76.0:" or "/name@1.0.0:" (older)
    const pnpm = /^\s{2,6}'?\/?((?:@[\w.-]+\/)?[\w.-]+)@[^\s'":(]+(?:\([^)]*\))*'?:\s*$/.exec(line);
    if (pnpm) names.add(pnpm[1]);
    // pnpm importers: "      '@sentry/react-native':" / "      react-native:" followed by specifier
    const dep = /^\s{6,8}'?((?:@[\w.-]+\/)?[\w.-]+)'?:\s*$/.exec(line);
    if (dep) names.add(dep[1]);
    // Gradle report: "+--- com.google.firebase:firebase-analytics:21.0.0 -> 21.1.0"
    const gradle = /(?:\+|\\)---\s+([\w.-]+:[\w.-]+)(?::|\s|$)/.exec(line);
    if (gradle) names.add(gradle[1]);
  }
  return names;
}

export function findDenied(text) {
  const hits = [];
  for (const name of packageNames(text)) {
    for (const [label, test] of DENYLIST) if (test(name)) hits.push({ name, label });
  }
  return hits;
}

/** A Gradle report that resolved nothing is a failed `gradlew` run, not a clean classpath: an empty file has no denylisted name in it. */
export function isUsableGradleReport(text) {
  for (const name of packageNames(text)) if (name.includes(':')) return true;
  return false;
}

/** In CI both flavors' resolved classpaths must have been written, so a missing report cannot pass as "nothing to check". */
const REQUIRED_REPORTS = ['dependencies-nosms.txt', 'dependencies-sms.txt'];

function defaultTargets() {
  const out = [];
  const lock = join(root, 'pnpm-lock.yaml');
  if (existsSync(lock)) out.push(lock);
  const reports = join(root, 'apps/mobile/android/app/build/reports');
  if (existsSync(reports)) for (const f of readdirSync(reports)) if (/^dependencies-.*\.txt$/.test(f)) out.push(join(reports, f));
  if (process.env.CI) {
    for (const name of REQUIRED_REPORTS) {
      const p = join(reports, name);
      if (!out.includes(p)) out.push(p); // reported below as missing
    }
  }
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const targets = process.argv.length > 2 ? process.argv.slice(2).map((p) => resolve(p)) : defaultTargets();
  if (targets.length === 0) {
    console.error('check-dependency-denylist: nothing to check (no pnpm-lock.yaml).');
    process.exit(1);
  }
  let failed = false;
  for (const file of targets) {
    if (!existsSync(file)) {
      console.error(`check-dependency-denylist: ${file} does not exist.`);
      failed = true;
      continue;
    }
    const text = readFileSync(file, 'utf8');
    if (/(^|[\\/])dependencies-[^\\/]*\.txt$/.test(file) && !isUsableGradleReport(text)) {
      console.error(`check-dependency-denylist: ${relative(root, file)} lists no dependencies: the gradle run that wrote it failed.`);
      failed = true;
      continue;
    }
    const hits = findDenied(text);
    for (const h of hits) {
      console.error(`${relative(root, file)}: ${h.name} is a denylisted ${h.label} dependency`);
      failed = true;
    }
    if (hits.length === 0) console.log(`ok  ${relative(root, file)}`);
  }
  if (failed) {
    console.error('\ncheck-dependency-denylist: wmbugo has no analytics, crash-reporting, ads, attribution or network SDK (AD-19).');
    process.exit(1);
  }
}
