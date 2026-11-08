#!/usr/bin/env node
// A standard release APK must not be debuggable (a debuggable build lets `run-as` read the app's private files).
// The opt-in -PwmbugoDebuggableRelease build exists only for device checks and the emulator CI job.
//
//   node scripts/check-not-debuggable.mjs                    # checks the nosms and sms release APKs
//   node scripts/check-not-debuggable.mjs <app.apk> ...      # checks the given APKs
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apkDir = (flavor) => join(root, 'apps/mobile/android/app/build/outputs/apk', flavor, 'release');

function findAapt2() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) throw new Error('ANDROID_HOME is not set');
  const tools = join(sdk, 'build-tools');
  const exe = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2';
  const versions = readdirSync(tools).sort().reverse();
  for (const v of versions) if (existsSync(join(tools, v, exe))) return join(tools, v, exe);
  throw new Error('aapt2 not found under ' + tools);
}

export function isDebuggable(badging) {
  return /application-debuggable|application: .*debuggable/.test(badging);
}

function main() {
  let apks = process.argv.slice(2);
  if (apks.length === 0) {
    apks = ['nosms', 'sms'].flatMap((f) => (existsSync(apkDir(f)) ? readdirSync(apkDir(f)).filter((n) => n.endsWith('.apk')).map((n) => join(apkDir(f), n)) : []));
  }
  if (apks.length === 0) {
    console.error('check-not-debuggable: no release APK found. Build one first (assembleNosmsRelease).');
    process.exit(2);
  }
  const aapt2 = findAapt2();
  let bad = 0;
  for (const apk of apks) {
    const out = execFileSync(aapt2, ['dump', 'badging', apk], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (isDebuggable(out)) {
      console.error(`check-not-debuggable: FAIL ${apk} is debuggable`);
      bad += 1;
    } else {
      console.log(`check-not-debuggable: OK ${apk}`);
    }
  }
  process.exit(bad === 0 ? 0 : 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
