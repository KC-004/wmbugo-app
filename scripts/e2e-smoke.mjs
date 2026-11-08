#!/usr/bin/env node
// End-to-end smoke test over adb on a fresh install (an emulator, where adb may inject input).
// It walks onboarding, records an expense with the HARDWARE keyboard (digit keys), saves, checks the toast,
// opens Activity and Home, and checks the saved amount shows up without a restart.
//
//   ANDROID_SERIAL=emulator-5554 node scripts/e2e-smoke.mjs
//
// Needs the nosms release APK (debuggable is fine) already installed with its data cleared:
//   adb shell pm clear app.wmbugo
import { execFileSync } from 'node:child_process';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dump() {
  const xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty');
  const nodes = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const attr = (name) => new RegExp(`${name}="([^"]*)"`).exec(m[0])?.[1] ?? '';
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr('bounds'));
    if (!b) continue;
    nodes.push({
      text: attr('text'),
      desc: attr('content-desc'),
      x: Math.round((Number(b[1]) + Number(b[3])) / 2),
      y: Math.round((Number(b[2]) + Number(b[4])) / 2),
    });
  }
  return nodes;
}

const labelOf = (n) => (n.desc || n.text).replace(/&amp;/g, '&');

async function find(label, { exact = false, tries = 12 } = {}) {
  for (let i = 0; i < tries; i++) {
    const hit = dump().find((n) => (exact ? labelOf(n) === label : labelOf(n).startsWith(label)));
    if (hit) return hit;
    await sleep(700);
  }
  throw new Error(`not found on screen: "${label}"`);
}

async function tap(label, opts) {
  const n = await find(label, opts);
  adb('shell', 'input', 'tap', String(n.x), String(n.y));
  await sleep(600);
}

const visible = (label) => dump().some((n) => labelOf(n).includes(label));
const steps = [];
const ok = (name) => {
  steps.push(name);
  console.log(`ok  ${name}`);
};

adb('shell', 'am', 'force-stop', 'app.wmbugo');
adb('shell', 'am', 'start', '-n', 'app.wmbugo/.MainActivity');
await sleep(4000);

// Onboarding: welcome, region (as detected), skip the account, payday, not now on the budget, finish.
await tap('Continue');
await tap('Continue');
await tap('Skip for now');
await tap('Last day');
await tap('Continue');
await tap('Not now');
await tap('Finish');
await find('Spent this period', { tries: 20 });
ok('onboarding finishes on Home');

// Add sheet: keypad focus, hardware keys 1 2 . 5 0
await tap('Add entry');
await find('Expense');
for (const k of ['KEYCODE_1', 'KEYCODE_2', 'KEYCODE_PERIOD', 'KEYCODE_5', 'KEYCODE_0']) {
  adb('shell', 'input', 'keyevent', k); // one key per call: a burst in one call can drop events
  await sleep(250);
}
await sleep(500);
if (!visible('12.50')) throw new Error('hardware keys did not type 12.50');
ok('hardware number keys type 12.50');
adb('shell', 'input', 'keyevent', 'KEYCODE_DEL');
await sleep(500);
if (!visible('12.5')) throw new Error('Backspace did not delete');
adb('shell', 'input', 'keyevent', 'KEYCODE_0');
await sleep(500);
ok('Backspace and re-type work');

await tap('Food & Drinks');
await tap('Save', { exact: true });
await find('Saved');
ok('Save shows the Saved toast');

// Activity lists it; Home reflects it; no restart.
await tap('Activity');
await find('Food & Drinks', { tries: 10 });
ok('Activity lists the new entry');
await tap('Home');
await find('Spent this period');
if (!visible('12.50')) throw new Error('Home did not show 12.50 spent');
ok('Home shows it as spent without a restart');

console.log(`\n${steps.length} checks passed`);
