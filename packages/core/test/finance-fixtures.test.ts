import { FIXTURES } from './fixtures/finance/fixtures';
import { runFixture } from './fixtures/finance/runner';

describe('GATE-07 finance fixtures', () => {
  it.each(FIXTURES.map((f) => [f.id, f.title, f] as const))('%s: %s', async (_id, _title, f) => {
    const r = await runFixture(f);
    expect(r.balances).toEqual(f.expected.balances);
    expect(r.totals.inAccountsMinor).toBe(f.expected.inAccounts);
    expect(r.totals.cardDuesMinor).toBe(f.expected.cardDues);
    expect(r.spent).toBe(f.expected.spent);
    expect(r.income).toBe(f.expected.income);
    expect(r.beforeTracking).toEqual(f.expected.beforeTracking ?? {});
  });

  it('a transfer never changes income or expense, whatever the account types', async () => {
    for (const f of FIXTURES.filter((x) => x.steps.some((s) => s.op === 'transfer'))) {
      const r = await runFixture(f);
      const transferSums = await r.db.query("SELECT t.id, SUM(p.signed_amount_minor) FROM \"transaction\" t JOIN posting p ON p.transaction_id = t.id WHERE t.event_type = 'transfer' GROUP BY t.id");
      expect(transferSums.length).toBeGreaterThan(0);
      for (const row of transferSums) expect(Number(row[1])).toBe(0);
    }
  });

  it('net worth is In accounts minus Card dues, and a limit is never part of any figure', async () => {
    const f6 = FIXTURES.find((f) => f.id === 'F6')!;
    const r = await runFixture(f6);
    expect(r.totals.netWorthMinor).toBe(7_000_000 - 650_000);
    expect(r.totals.notSetCards).toBe(1);
    expect(r.totals.notSetAssets).toBe(0);
  });
});
