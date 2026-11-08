#!/usr/bin/env node
// Fails if any lockfile other than the root pnpm-lock.yaml exists (node_modules excluded).
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const FOREIGN = new Set(['package-lock.json', 'yarn.lock', 'npm-shrinkwrap.json', 'bun.lockb', 'bun.lock']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', '.gradle', 'Pods', '.cxx']);

const root = resolve(process.argv[2] ?? process.cwd());
const found = [];
const nestedPnpm = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
    } else if (FOREIGN.has(entry.name)) {
      found.push(relative(root, full));
    } else if (entry.name === 'pnpm-lock.yaml' && dir !== root) {
      nestedPnpm.push(relative(root, full));
    }
  }
}

walk(root);

const offenders = [...found, ...nestedPnpm];
if (offenders.length > 0) {
  console.error('check-lockfiles: only the root pnpm-lock.yaml is allowed. Remove:');
  for (const f of offenders) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-lockfiles: OK (single root pnpm-lock.yaml)');
