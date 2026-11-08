import fc from 'fast-check';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { ACCOUNT_LIST_SQL, mapAccountRows, openingPostingMinor, type AccountRow, type AccountType } from './accounts';
import { beforeTrackingStarted, cardPosition, notSetNote, overviewTotals } from './balances';
import { entryShape } from './entryCommands';
import { homeAccounts, INCOME_SQL, SPENT_EXPENSES_SQL } from './readModels';
import { OTHER_CATEGORY_ID } from './transferCommands';
import { recordEntry, recordTransfer } from '../testing/capture';

const row = (over: Partial<AccountRow>): AccountRow => ({
  id: 'a', name: 'A', type: 'bank', icon: 'Bank', colorToken: 'cat-indigo', sortOrder: 0, status: 'active', balanceNotSet: false, postingsMinor: 0, ...over,
});

describe('card position', () => {
  it('outstanding is the negation of the ledger balance: opening dues 45000 plus a 20000 charge is 65000', () => {
    expect(cardPosition({ balanceNotSet: false, postingsMinor: -45000 - 20000 })).toEqual({ kind: 'owed', outstandingMinor: 65000 });
  });
  it('a card above zero is in credit, never a negative outstanding', () => {
    expect(cardPosition({ balanceNotSet: false, postingsMinor: 1500 })).toEqual({ kind: 'in-credit', inCreditMinor: 1500 });
  });
  it('a settled card owes zero, and a card with no balance is not set', () => {
    expect(cardPosition({ balanceNotSet: false, postingsMinor: 0 })).toEqual({ kind: 'owed', outstandingMinor: 0 });
    expect(cardPosition({ balanceNotSet: true, postingsMinor: 0 })).toEqual({ kind: 'not-set' });
  });
});

describe('overview totals', () => {
  it('keeps In accounts and Card dues apart, and a card is never inside an asset figure', () => {
    const t = overviewTotals([row({ id: '1', postingsMinor: 100000 }), row({ id: '2', type: 'card', postingsMinor: -30000 })]);
    expect(t).toMatchObject({ inAccountsMinor: 100000, cardDuesMinor: 30000, netWorthMinor: 70000 });
  });
  it('counts not-set assets and cards separately and never as zero', () => {
    const t = overviewTotals([row({ id: '1', balanceNotSet: true }), row({ id: '2', type: 'card', balanceNotSet: true }), row({ id: '3', type: 'card', balanceNotSet: true })]);
    expect(t).toEqual({ inAccountsMinor: null, cardDuesMinor: null, cardsInCreditMinor: 0, notSetAssets: 1, notSetCards: 2, netWorthMinor: null });
  });
  it('leaves out archived accounts and accounts switched out of totals', () => {
    const t = overviewTotals([row({ id: '1', postingsMinor: 100 }), row({ id: '2', postingsMinor: 5000, includeInOverview: false }), row({ id: '3', postingsMinor: 9000, status: 'archived' })]);
    expect(t.inAccountsMinor).toBe(100);
  });
  it('shows credit on a card apart from dues', () => {
    const t = overviewTotals([row({ id: '1', type: 'card', postingsMinor: 4000 }), row({ id: '2', type: 'card', postingsMinor: -1000 })]);
    expect(t).toMatchObject({ cardDuesMinor: 1000, cardsInCreditMinor: 4000 });
  });
  it('Home reads the same query', () => {
    expect(homeAccounts([row({ postingsMinor: 700 }), row({ id: 'c', type: 'card', balanceNotSet: true })])).toEqual({
      hasAccounts: true, inAccountsMinor: 700, notSetCount: 0, cardDuesMinor: null, notSetCards: 1,
    });
  });
});

describe('presenters', () => {
  it('words the not-set notes', () => {
    expect(notSetNote(0, 'account')).toBeNull();
    expect(notSetNote(1, 'account')).toBe('+1 account not set');
    expect(notSetNote(2, 'account')).toBe('+2 accounts not set');
    expect(notSetNote(1, 'card')).toBe('+1 card not set');
    expect(notSetNote(3, 'card')).toBe('+3 cards not set');
  });
  it('tracking start is derived on read', () => {
    expect(beforeTrackingStarted(100, 200)).toBe(true);
    expect(beforeTrackingStarted(200, 200)).toBe(false);
    expect(beforeTrackingStarted(100, null)).toBe(false);
  });
});

// ---- the property suite: random sequences of openings, expenses, incomes, transfers, card charges and payments ----

const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const PERIOD: [string, string] = ['2026-11-01', '2026-11-30'];
const TYPES: AccountType[] = ['bank', 'cash', 'wallet', 'savings_pot', 'card'];

type Cmd =
  | { t: 'expense'; a: number; m: number; before: boolean }
  | { t: 'income'; a: number; m: number }
  | { t: 'transfer'; a: number; b: number; m: number; fee: number };

const arbCmd: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ t: fc.constant('expense' as const), a: fc.nat(5), m: fc.integer({ min: 1, max: 100000 }), before: fc.boolean() }),
  fc.record({ t: fc.constant('income' as const), a: fc.nat(5), m: fc.integer({ min: 1, max: 100000 }) }),
  fc.record({ t: fc.constant('transfer' as const), a: fc.nat(5), b: fc.nat(5), m: fc.integer({ min: 1, max: 100000 }), fee: fc.integer({ min: 0, max: 500 }) }),
);
const arbAccounts = fc.array(fc.record({ type: fc.constantFrom(...TYPES), opening: fc.option(fc.integer({ min: 0, max: 200000 }), { nil: null }) }), { minLength: 1, maxLength: 6 });

describe('balance property suite (FIN-011, FIN-013, LIR-01)', () => {
  it('every balance is the opening plus its applicable postings; transfers sum to zero and are neither income nor expense', async () => {
    await fc.assert(
      fc.asyncProperty(arbAccounts, fc.array(arbCmd, { maxLength: 18 }), async (accounts, cmds) => {
        const db = new NodeSqliteDatabase().applyRealMigrations();
        const clock = new FakeClock(NOW, 'Asia/Singapore');
        const writer = new LedgerWriter({
          uow: db, clock, newId: createIdGenerator(clock, seededRandom(1)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape],
        });
        await writer.run(SetUpProfile, { region: findRegion('SG')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Singapore' }, 'user');

        const ids: string[] = [];
        const model: (number | null)[] = [];
        const openedAt: number[] = [];
        for (const [i, a] of accounts.entries()) {
          clock.advance(1000);
          const r = await writer.run(AddAccount, { name: `A${i}`, type: a.type, openingMinor: a.opening }, 'user');
          if (!r.ok) throw new Error('account');
          ids.push(r.value.accountId);
          model.push(a.opening === null ? null : openingPostingMinor(a.type, a.opening));
          openedAt.push(clock.nowMs());
        }
        let expenses = 0;
        let incomes = 0;
        for (const c of cmds) {
          clock.advance(1000);
          const a = c.t === 'transfer' ? c.a % ids.length : c.a % ids.length;
          if (c.t === 'expense') {
            const at = c.before ? openedAt[a]! - 5000 : clock.nowMs();
            const r = await recordEntry(writer, { kind: 'expense', amountMinor: c.m, categoryId: 'cat_food', accountId: ids[a]!, occurredAtMs: at });
            if (!r.ok) throw new Error('expense');
            expenses += c.m;
            // An account with no opening balance has no opening instant, so nothing is "before" it.
            const tracked = accounts[a]!.opening !== null;
            if (!tracked || at >= openedAt[a]!) model[a] = (model[a] ?? 0) - c.m;
          } else if (c.t === 'income') {
            const r = await recordEntry(writer, { kind: 'income', amountMinor: c.m, categoryId: 'cat_in_salary', accountId: ids[a]! });
            if (!r.ok) throw new Error('income');
            incomes += c.m;
            model[a] = (model[a] ?? 0) + c.m;
          } else {
            const b = c.b % ids.length;
            if (a === b) continue;
            const r = await recordTransfer(writer, { amountMinor: c.m, fromAccountId: ids[a]!, toAccountId: ids[b]!, ...(c.fee > 0 ? { fee: { amountMinor: c.fee, categoryId: OTHER_CATEGORY_ID } } : {}) });
            if (!r.ok) throw new Error('transfer ' + r.code);
            model[a] = (model[a] ?? 0) - c.m - c.fee;
            model[b] = (model[b] ?? 0) + c.m;
            expenses += c.fee;
          }
        }

        const rows = mapAccountRows(await db.query(ACCOUNT_LIST_SQL));
        for (const [i, r] of rows.entries()) {
          // A not-set account has no displayed balance; its ledger sum is still what the postings add up to.
          expect(r.postingsMinor).toBe(model[i] ?? 0);
        }
        const sums = await db.query("SELECT t.id, SUM(p.signed_amount_minor) FROM \"transaction\" t JOIN posting p ON p.transaction_id = t.id WHERE t.event_type = 'transfer' GROUP BY t.id");
        for (const s of sums) expect(Number(s[1])).toBe(0);
        expect(Number((await db.query(SPENT_EXPENSES_SQL, PERIOD))[0]![0])).toBe(expenses);
        expect(Number((await db.query(INCOME_SQL, PERIOD))[0]![0])).toBe(incomes);

        // The overview is built from the same rows: it never sums assets and cards into one figure.
        const t = overviewTotals(rows);
        const known = rows.filter((r) => !r.balanceNotSet && r.type !== 'card');
        expect(t.inAccountsMinor).toBe(known.length ? known.reduce((n, r) => n + r.postingsMinor, 0) : null);
        const cards = rows.filter((r) => !r.balanceNotSet && r.type === 'card');
        expect(t.cardDuesMinor).toBe(cards.length ? cards.reduce((n, r) => n + Math.max(0, -r.postingsMinor), 0) : null);
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
