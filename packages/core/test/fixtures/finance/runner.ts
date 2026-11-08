import { FakeClock } from '../../../src/shared/clock';
import { createRedactingLogger } from '../../../src/shared/logger';
import { ok } from '../../../src/shared/result';
import { createIdGenerator, seededRandom } from '../../../src/shared/uuid';
import { NodeSqliteDatabase } from '../../../src/testing/nodeSqlite';
import { SetUpProfile } from '../../../src/usecases/setUpProfile';
import { findRegion } from '../../../src/profile/regions';
import { LedgerWriter, type UseCase } from '../../../src/writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from '../../../src/ledger/accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows } from '../../../src/ledger/accounts';
import { BEFORE_TRACKING_SQL, overviewTotals } from '../../../src/ledger/balances';
import { entryShape, RecordManualEntry } from '../../../src/ledger/entryCommands';
import { INCOME_SQL, SPENT_EXPENSES_SQL, SPENT_REFUNDS_SQL, spentMinor } from '../../../src/ledger/readModels';
import { OTHER_CATEGORY_ID, RecordTransfer } from '../../../src/ledger/transferCommands';
import type { Fixture } from './fixtures';

/** 2026-11-08 10:00 UTC. Local time is 15:30 in Kolkata and 18:00 in Singapore: the same date everywhere. */
export const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
export const PERIOD = ['2026-11-01', '2026-11-30'] as const;
const DAY = 86_400_000;

const TZ = { IN: 'Asia/Kolkata', SG: 'Asia/Singapore' } as const;

/**
 * Test-only: writes one adjustment posting for the difference between an account's balance and a target.
 * (The user-facing Adjust balance, with a reason, is Story 2.5.)
 */
const adjustTo = (accountId: string, toMinor: number): UseCase<void, void, never> => ({
  name: 'FixtureAdjust',
  async execute(ctx) {
    const rows = await ctx.query(ACCOUNT_LIST_SQL);
    const row = mapAccountRows(rows).find((r) => r.id === accountId)!;
    const diff = toMinor - row.postingsMinor;
    const at = ctx.nowMs();
    const t = ctx.newId();
    await ctx.execute(
      "INSERT INTO \"transaction\" (id, event_type, status, amount_minor, occurred_at_utc, local_date, timezone_id, tags_json, needs_category, created_at, updated_at) VALUES (?, 'adjustment', 'confirmed', ?, ?, '2026-11-08', 'UTC', '[]', 0, ?, ?)",
      [t, Math.abs(diff), at, at, at],
    );
    await ctx.execute("INSERT INTO posting (id, transaction_id, account_id, direction, signed_amount_minor, posting_kind) VALUES (?, ?, ?, ?, ?, 'adjustment')", [ctx.newId(), t, accountId, diff >= 0 ? 'in' : 'out', diff]);
    ctx.touch('transaction', t, { eventType: 'adjustment' });
    return ok(undefined);
  },
});

export async function runFixture(f: Fixture) {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, TZ[f.region]);
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(11)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape, entryShape],
  });
  const region = findRegion(f.region)!;
  const setUp = await writer.run(SetUpProfile, { region, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: TZ[f.region] }, 'user');
  if (!setUp.ok) throw new Error('setup ' + setUp.code);

  const ids = new Map<string, string>();
  const id = (name: string) => ids.get(name) ?? (() => { throw new Error('no account ' + name); })();
  const must = <T extends { ok: boolean }>(r: T, what: string): T => {
    if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r)}`);
    return r;
  };

  for (const s of f.steps) {
    clock.advance(1000);
    switch (s.op) {
      case 'account': {
        const r = must(await writer.run(AddAccount, { name: s.name, type: s.type, openingMinor: s.opening }, 'user'), 'account');
        if (r.ok) ids.set(s.name, r.value.accountId);
        break;
      }
      case 'adjust':
        must(await writer.run(adjustTo(id(s.account), s.toMinor), undefined, 'user'), 'adjust');
        break;
      case 'expense':
        must(await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: s.minor, categoryId: 'cat_food', accountId: id(s.account), ...(s.daysAgo ? { occurredAtMs: clock.nowMs() - s.daysAgo * DAY } : {}) }, 'user'), 'expense');
        break;
      case 'income':
        must(await writer.run(RecordManualEntry, { kind: 'income', amountMinor: s.minor, categoryId: 'cat_in_salary', accountId: id(s.account) }, 'user'), 'income');
        break;
      case 'transfer':
        must(
          await writer.run(RecordTransfer, { amountMinor: s.minor, fromAccountId: id(s.from), toAccountId: id(s.to), ...(s.fee ? { fee: { amountMinor: s.fee, categoryId: OTHER_CATEGORY_ID } } : {}) }, 'user'),
          'transfer',
        );
        break;
    }
  }

  const rows = mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
  const balances: Record<string, number | null> = {};
  for (const r of rows) balances[r.name] = r.balanceNotSet ? null : r.postingsMinor;
  const totals = overviewTotals(rows);
  const expenses = Number((await db.query(SPENT_EXPENSES_SQL, [...PERIOD]))[0]![0]);
  const refunds = Number((await db.query(SPENT_REFUNDS_SQL, [...PERIOD]))[0]![0]);
  const income = Number((await db.query(INCOME_SQL, [...PERIOD]))[0]![0]);
  const beforeTracking: Record<string, number> = {};
  for (const r of rows) {
    const n = (await db.query(BEFORE_TRACKING_SQL, [r.id])).length;
    if (n > 0) beforeTracking[r.name] = n;
  }
  return { db, writer, rows, balances, totals, spent: spentMinor(expenses, refunds), income, beforeTracking };
}
