import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { useUiStore } from './uiStore';

const FORBIDDEN = /\b(amounts?|balances?|totals?|money|minor|currency|payday|preferences?|settings?)\b/i;

/** Names a Zustand store file uses that suggest money or persistent preferences. */
export function storePolicyViolations(source: string): string[] {
  if (!/from\s+['"]zustand(\/[^'"]*)?['"]/.test(source)) return [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...new Set(code.match(new RegExp(FORBIDDEN, 'gi')) ?? [])];
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

describe('Zustand holds transient UI state only', () => {
  it('flags money and preference names in a store (self-check)', () => {
    const bad = `import { create } from 'zustand';\nexport const s = create(() => ({ totalAmount: 0, currency: 'INR' }));`;
    expect(storePolicyViolations(bad).length).toBeGreaterThan(0);
    expect(storePolicyViolations(`import { create } from 'zustand';\nconst x = { darkSetting: true };`)).toEqual([]);
    expect(storePolicyViolations(`const total = 1;`)).toEqual([]); // not a store file
    expect(storePolicyViolations(`import { create } from 'zustand';\n// total balance is fine in a comment\nconst a = 1;`)).toEqual([]);
  });

  it('no store file under src declares money or persistent-preference state', () => {
    const root = resolve(__dirname, '../..');
    const offenders = files(root)
      .map((f) => [f, storePolicyViolations(readFileSync(f, 'utf8'))] as const)
      .filter(([, v]) => v.length > 0);
    expect(offenders).toEqual([]);
  });

  it('the UI store opens and closes a sheet and starts empty', () => {
    expect(useUiStore.getState().openSheet).toBeNull();
    useUiStore.getState().openSheetById('add');
    expect(useUiStore.getState().openSheet).toBe('add');
    useUiStore.getState().closeSheet();
    expect(useUiStore.getState().openSheet).toBeNull();
  });
});
