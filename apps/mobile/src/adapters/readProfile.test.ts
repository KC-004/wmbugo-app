import { periodFor, periodLabel, periodRule, SETTINGS_SQL, type SqlDatabase } from '@wmbugo/core';
import { PROFILE_SQL, readProfile } from './readProfile';

/** A database that answers the two reads readProfile makes. */
function fakeDb(settings: [string, string][]): SqlDatabase {
  return {
    query: async (sql: string) => {
      if (sql === PROFILE_SQL) return [['IN', 'INR', 2, 'en-IN', 'Asia/Kolkata', 'day', 25]];
      if (sql === SETTINGS_SQL) return settings;
      return [];
    },
  } as unknown as SqlDatabase;
}

const TRANSITION = JSON.stringify([{ start: '2026-11-01', end: '2026-11-24', previous: { kind: 'first' }, normalDays: 30 }]);

describe('readProfile and the payday history (Story 4.8)', () => {
  it('Home, budgets and Insights all get the same period dates: 1–24 Nov is one shortened cycle', async () => {
    const p = (await readProfile(fakeDb([['finance.payday_transitions', TRANSITION]])))!;
    const rule = periodRule(p.payday, p.settings.periodMode);
    expect(periodFor('2026-11-10', rule)).toMatchObject({ start: '2026-11-01', end: '2026-11-24', shortened: true });
    expect(periodFor('2026-11-25', rule)).toMatchObject({ start: '2026-11-25', end: '2026-12-24' });
    expect(periodLabel(periodFor('2026-11-10', rule), '2026-11-10')).toBe('1–24 Nov · Shortened cycle');
  });

  it('with no history it is the plain pay cycle, and an unreadable history is ignored', async () => {
    const plain = (await readProfile(fakeDb([])))!;
    expect(periodFor('2026-11-10', periodRule(plain.payday, plain.settings.periodMode))).toMatchObject({ start: '2026-10-25', end: '2026-11-24' });
    const bad = (await readProfile(fakeDb([['finance.payday_transitions', 'not json']])))!;
    expect(bad.payday.transitions).toBeUndefined();
  });
});
