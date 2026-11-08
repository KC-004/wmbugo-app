#!/usr/bin/env node
// Proves each failure case of the Story 1.1 I/O matrix actually fails the gate.
// Each case drops a temporary bad file into the workspace, runs the real gate,
// asserts a non-zero exit plus the expected message, then removes the file.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => join(root, 'scripts/__fixtures__', name);

function run(cmd) {
  const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function withTempFile(target, write, fn) {
  if (existsSync(target)) throw new Error(`refusing to overwrite existing ${target}`);
  write(target);
  try {
    return fn();
  } finally {
    rmSync(target, { force: true });
  }
}

const results = [];
function expectFail(label, cmd, patterns) {
  const { code, out } = run(cmd);
  const missing = patterns.filter((p) => !p.test(out));
  const ok = code !== 0 && missing.length === 0;
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (exit ${code})`);
  if (!ok) console.log(out.split('\n').map((l) => `      ${l}`).join('\n'), '\n      missing:', missing);
}
function expectPass(label, cmd) {
  const { code, out } = run(cmd);
  const ok = code === 0;
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (exit ${code})`);
  if (!ok) console.log(out);
}

const copy = (src) => (dst) => copyFileSync(src, dst);

// 1. Boundary imports in core: lint AND typecheck must fail.
for (const [fixture, mod] of [
  ['boundary-react-native.ts.fixture', 'react-native'],
  ['boundary-drizzle.ts.fixture', 'drizzle-orm'],
  ['boundary-op-sqlite.ts.fixture', '@op-engineering/op-sqlite'],
]) {
  withTempFile(join(root, 'packages/core/src/__gate_boundary.ts'), copy(fx(fixture)), () => {
    expectFail(`boundary ${mod}: pnpm lint`, 'pnpm lint', [/Boundary: packages\/core/, /no-restricted-imports/]);
    expectFail(`boundary ${mod}: pnpm typecheck`, 'pnpm typecheck', [/Boundary: packages\/core must not import/, /__forbidden__/]);
  });
}

// 2. console.log in core and mobile src.
for (const target of ['packages/core/src/__gate_console.ts', 'apps/mobile/src/__gate_console.ts']) {
  withTempFile(join(root, target), copy(fx('console-log.ts.fixture')), () => {
    expectFail(`console.log in ${target}: pnpm lint`, 'pnpm lint', [/no-console/]);
  });
}

// 3. Foreign lockfiles anywhere outside node_modules.
for (const target of [
  'package-lock.json',
  'apps/mobile/yarn.lock',
  'packages/core/package-lock.json',
  'apps/mobile/pnpm-lock.yaml',
]) {
  withTempFile(join(root, target), (p) => writeFileSync(p, '{}\n'), () => {
    expectFail(`foreign lockfile ${target}: pnpm check:lockfiles`, 'pnpm check:lockfiles', [
      // The offending path is named (OS separators, so match either slash).
      new RegExp(target.replaceAll('.', '[.]').replaceAll('/', '[\\\\/]')),
    ]);
  });
}

// 4. Forbidden permissions in a merged release manifest: each one listed.
expectFail('forbidden permissions: check-permissions', `node scripts/check-permissions.mjs "${fx('manifest-forbidden.xml')}"`, [
  /android\.permission\.INTERNET \(banned\)/,
  /android\.permission\.ACCESS_NETWORK_STATE \(banned\)/,
  /android\.permission\.READ_CONTACTS \(not allowlisted\)/,
]);

// uses-permission-sdk-23 is parsed too.
expectFail('uses-permission-sdk-23 INTERNET: check-permissions', `node scripts/check-permissions.mjs "${fx('manifest-sdk23-internet.xml')}"`, [
  /android\.permission\.INTERNET \(banned\)/,
]);

// A banned permission marked tools:node="remove" is not counted.
expectPass('tools:node="remove" INTERNET: check-permissions', `node scripts/check-permissions.mjs "${fx('manifest-tools-remove.xml')}"`);

// 5. Clean release manifest passes.
expectPass('clean manifest: check-permissions', `node scripts/check-permissions.mjs "${fx('manifest-clean.xml')}"`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gate cases behaved as expected`);
process.exit(failed.length ? 1 : 0);
