#!/usr/bin/env node
// Checks the merged RELEASE manifests of both flavors against the permission allowlist.
//
// Usage:
//   node scripts/check-permissions.mjs                 # checks nosmsRelease + smsRelease build output
//   node scripts/check-permissions.mjs <manifest.xml>  # checks the given merged manifest(s)
//
// Build the merged manifests first, e.g.
//   cd apps/mobile/android && ./gradlew processNosmsReleaseMainManifest processSmsReleaseMainManifest
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const APPLICATION_ID = 'app.wmbugo';
const VARIANTS = ['nosmsRelease', 'smsRelease'];
const mergedRoot = join(repoRoot, 'apps/mobile/android/app/build/intermediates/merged_manifest');

const allowlist = JSON.parse(readFileSync(join(here, 'android-permission-allowlist.json'), 'utf8'));
const sub = (p) => p.replaceAll('${applicationId}', APPLICATION_ID);
const allowed = new Set(allowlist.allowed.map(sub));
const banned = new Set(allowlist.banned.map(sub));

function findManifest(dir) {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const nested = findManifest(full);
      if (nested) return nested;
    } else if (entry === 'AndroidManifest.xml') {
      return full;
    }
  }
  return undefined;
}

function permissionsIn(xml) {
  const names = [];
  const tag = /<uses-permission(?:-sdk-23)?\b[^>]*>/g;
  for (const m of xml.matchAll(tag)) {
    // A permission removed via tools:node="remove" never reaches the merged manifest,
    // but guard anyway when a raw (unmerged) manifest is passed in.
    if (/tools:node\s*=\s*"remove"/.test(m[0])) continue;
    const name = /android:name\s*=\s*"([^"]+)"/.exec(m[0]);
    if (name) names.push(sub(name[1]));
  }
  return names;
}

const targets = [];
const cliPaths = process.argv.slice(2);
if (cliPaths.length > 0) {
  for (const p of cliPaths) targets.push({ label: p, path: resolve(p) });
} else {
  for (const v of VARIANTS) targets.push({ label: v, path: findManifest(join(mergedRoot, v)) });
}

let failed = false;
for (const { label, path } of targets) {
  if (!path || !existsSync(path)) {
    console.error(
      `check-permissions: no merged manifest for ${label}. Build it first:\n` +
        '  cd apps/mobile/android && ./gradlew processNosmsReleaseMainManifest processSmsReleaseMainManifest',
    );
    failed = true;
    continue;
  }
  const perms = permissionsIn(readFileSync(path, 'utf8'));
  const offending = perms.filter((p) => banned.has(p) || !allowed.has(p));
  const where = relative(repoRoot, path) || path;
  if (offending.length > 0) {
    failed = true;
    console.error(`check-permissions: ${label} (${where}) has forbidden permissions:`);
    for (const p of offending) console.error(`  - ${p}${banned.has(p) ? ' (banned)' : ' (not allowlisted)'}`);
  } else {
    console.log(`check-permissions: ${label} OK (${perms.length ? perms.join(', ') : 'no permissions'})`);
  }
}

process.exit(failed ? 1 : 0);
