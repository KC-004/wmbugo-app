import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { findRegion } from '../profile/regions';
import { LedgerWriter } from '../writer/ledgerWriter';
import { createSubmitCapture, SubmitCapture, type SubmitInput } from '../capture/submitCapture';
import { MergeDuplicate } from '../capture/resolveDuplicate';
import { captureStateOf } from '../capture/statusLabel';
import type { CategorySuggester } from '../ports/categorySuggester';
import { AddAccount, openingBalanceShape } from './accountCommands';
import { UNCATEGORISED_ID } from './categories';
import { BulkRecategorise, UndoBulkRecategorise } from './bulk';
import { ApplySuggestion, ConfirmCategory } from './categoryGuess';
import { SaveCategory } from './categoryCommands';
import { ArchiveCategory } from './categoryArchive';
import { EditTransaction, RestoreTransaction, TRANSACTION_DETAIL_SQL, mapTransactionDetail } from './editCommands';
import { entryShape } from './entryCommands';
import { ACTIVITY_SQL, mapActivityRows, rowState } from './readModels';
import { SetSplits } from './splits';

const at = Date.UTC(2026, 10, 8, 9, 0, 0);

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(Date.UTC(2026, 10, 8, 10, 0, 0), 'Asia/Kolkata');
  const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(21)), logger: createRedactingLogger({ write: () => undefined }), invariants: [openingBalanceShape, entryShape] });
  const p = await writer.run(SetUpProfile, { region: findRegion('IN')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Kolkata' }, 'user');
  if (!p.ok) throw new Error('setup');
  clock.advance(1000);
  const a = await writer.run(AddAccount, { name: 'HDFC', type: 'bank', openingMinor: 10_000_000 }, 'user');
  if (!a.ok) throw new Error('account');
  const accountId = a.value.accountId;
  /** A suggester fixture: always answers with one category (or nothing). */
  const fixture = (categoryId: string | null): CategorySuggester & { calls: number } => {
    const s = {
      calls: 0,
      async suggest() {
        s.calls += 1;
        return categoryId === null ? null : { categoryId, reason: 'fixture' };
      },
    };
    return s;
  };
  /** A captured entry (an SMS) that arrives with no category, so it is the suggester's to fill. */
  const capture = (submit: ReturnType<typeof createSubmitCapture>, n: number, over: Partial<{ merchant: string; amountMinor: number }> = {}) =>
    writer.run(submit, { submissionId: `sms-${n}`, sourceKind: 'sms', entry: { kind: 'expense', amountMinor: over.amountMinor ?? 10_000 + n, categoryId: UNCATEGORISED_ID, accountId, merchant: over.merchant ?? `Shop ${n}`, occurredAtMs: at + n } } satisfies SubmitInput, 'system');
  const manual = (categoryId: string, n: number) =>
    writer.run(SubmitCapture, { submissionId: `man-${n}`, sourceKind: 'manual', entry: { kind: 'expense', amountMinor: 20_000 + n, categoryId, accountId, merchant: `Man ${n}`, occurredAtMs: at + n } }, 'user');
  const row = async (id: string) => (await db.query('SELECT category_guessed, category_set_by, capture_resolution FROM "transaction" WHERE id = ?', [id]))[0]!.map((x) => (x === null ? null : typeof x === 'number' ? x : String(x)));
  const category = async (id: string) => String((await db.query('SELECT category_id FROM split WHERE transaction_id = ?', [id]))[0]![0]);
  const events = async (name: string) => (await db.query('SELECT actor, payload_json FROM outbox WHERE event = ? ORDER BY created_at, id', [name])).map((r) => ({ actor: String(r[0]), payload: JSON.parse(String(r[1])) as Record<string, unknown> }));
  const state = async (id: string) => {
    const rows = mapActivityRows(await db.query(ACTIVITY_SQL, [100]));
    const mine = rows.find((r) => r.id === id);
    return mine ? rowState(mine) : null;
  };
  return { db, writer, accountId, fixture, capture, manual, row, category, events, state };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

describe('the classify stage and CategorySuggester (Story 4.4)', () => {
  it('the default pipeline asks nothing: a captured entry stays Uncategorised, not guessed', async () => {
    const { writer, row, category, accountId } = await setup();
    const r = ok(await writer.run(SubmitCapture, { submissionId: 'sms-x', sourceKind: 'sms', entry: { kind: 'expense', amountMinor: 5_000, categoryId: UNCATEGORISED_ID, accountId, merchant: 'X' } }, 'system'));
    expect(await category(r.value.transactionId)).toBe(UNCATEGORISED_ID);
    expect((await row(r.value.transactionId)).slice(0, 2)).toEqual([0, null]);
  });

  it('a suggestion is written as a guess: category_guessed = 1, set by the suggester, and the Activity row reads guessed', async () => {
    const { writer, fixture, capture, row, category, state, db } = await setup();
    const s = fixture('cat_groceries');
    const r = ok(await capture(createSubmitCapture({ suggester: s }), 1));
    const id = r.value.transactionId;
    expect(s.calls).toBe(1);
    expect(await category(id)).toBe('cat_groceries');
    expect((await row(id)).slice(0, 2)).toEqual([1, 'suggester']);
    expect(await state(id)).toBe('guessed');
    const d = mapTransactionDetail(await db.query(TRANSACTION_DETAIL_SQL, [id]))!;
    expect(d.categoryGuessed).toBe(true);
    expect(captureStateOf({ status: 'confirmed', resolution: 'auto_approved', needsCategory: false, categoryGuessed: d.categoryGuessed === true, openDuplicate: false })).toBe('recorded_category_guessed');
    void writer;
  });

  it('a manual save never gets a suggestion, even with a suggester that always answers', async () => {
    const { writer, fixture, row, category, manual, accountId } = await setup();
    const s = fixture('cat_groceries');
    // The same pipeline with a suggester, fed a manual entry that chose a category.
    const r = ok(await writer.run(createSubmitCapture({ suggester: s }), { submissionId: 'man-s', sourceKind: 'manual', entry: { kind: 'expense', amountMinor: 7_000, categoryId: 'cat_food', accountId, merchant: 'Cafe' } }, 'user'));
    expect(s.calls).toBe(0);
    expect(await category(r.value.transactionId)).toBe('cat_food');
    expect((await row(r.value.transactionId)).slice(0, 2)).toEqual([0, 'user']);
    const m = ok(await manual('cat_travel', 2));
    expect((await row(m.value.transactionId)).slice(0, 2)).toEqual([0, 'user']);
  });

  it('a suggestion for an archived or wrong-kind category is ignored', async () => {
    const { writer, fixture, capture, row, category } = await setup();
    const a = ok(await capture(createSubmitCapture({ suggester: fixture('cat_in_salary') }), 1));
    expect(await category(a.value.transactionId)).toBe(UNCATEGORISED_ID);
    expect((await row(a.value.transactionId)).slice(0, 2)).toEqual([0, null]);
    ok(await writer.run(SaveCategory, { name: 'Fuel', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'need' }, 'user'));
    expect((await writer.run(ArchiveCategory, { categoryId: 'cat_travel' }, 'user')).ok).toBe(true);
    const b = ok(await capture(createSubmitCapture({ suggester: fixture('cat_travel') }), 2));
    expect(await category(b.value.transactionId)).toBe(UNCATEGORISED_ID);
  });
});

describe('overriding a guess (Story 4.4)', () => {
  it('picking Groceries saves it, clears the guess, and CategoryAssigned carries the previous category and wasGuessed', async () => {
    const { writer, fixture, capture, row, category, events, state } = await setup();
    const id = ok(await capture(createSubmitCapture({ suggester: fixture('cat_food') }), 1)).value.transactionId;
    const edit = ok(await writer.run(EditTransaction, { transactionId: id, entry: { categoryId: 'cat_groceries' } }, 'user'));
    expect(edit.value.categoryChanged).toBe(true);
    expect(await category(id)).toBe('cat_groceries');
    expect((await row(id)).slice(0, 2)).toEqual([0, 'user']);
    expect(await state(id)).toBe('expense');
    const last = (await events('CategoryAssigned')).at(-1)!;
    expect(last.actor).toBe('user');
    expect(last.payload).toMatchObject({ transactionIds: [id], previousCategoryId: 'cat_food', wasGuessed: true });
  });

  it('Undo of that edit puts the guess back exactly', async () => {
    const { writer, fixture, capture, row, category } = await setup();
    const id = ok(await capture(createSubmitCapture({ suggester: fixture('cat_food') }), 1)).value.transactionId;
    const edit = ok(await writer.run(EditTransaction, { transactionId: id, entry: { categoryId: 'cat_groceries' } }, 'user'));
    ok(await writer.run(RestoreTransaction, { snapshot: edit.value.snapshot }, 'user'));
    expect(await category(id)).toBe('cat_food');
    expect((await row(id)).slice(0, 2)).toEqual([1, 'suggester']);
  });

  it('Looks right clears the guess without changing the category, and CategoryAssigned carries the same category', async () => {
    const { writer, fixture, capture, row, category, events, state } = await setup();
    const id = ok(await capture(createSubmitCapture({ suggester: fixture('cat_food') }), 1)).value.transactionId;
    ok(await writer.run(ConfirmCategory, { transactionId: id }, 'user'));
    expect(await category(id)).toBe('cat_food');
    expect((await row(id)).slice(0, 2)).toEqual([0, 'user']);
    expect(await state(id)).toBe('expense');
    const last = (await events('CategoryAssigned')).at(-1)!;
    expect(last.actor).toBe('user');
    expect(last.payload).toMatchObject({ transactionIds: [id], previousCategoryId: 'cat_food', wasGuessed: true });
    // Nothing left to confirm.
    expect(await writer.run(ConfirmCategory, { transactionId: id }, 'user')).toMatchObject({ ok: false, code: 'NOT_GUESSED' });
  });

  it('Looks right on an entry that was never a guess is refused and writes nothing', async () => {
    const { writer, manual, events } = await setup();
    const m = ok(await manual('cat_food', 1));
    const before = (await events('CategoryAssigned')).length;
    expect(await writer.run(ConfirmCategory, { transactionId: m.value.transactionId }, 'user')).toMatchObject({ ok: false, code: 'NOT_GUESSED' });
    expect((await events('CategoryAssigned')).length).toBe(before);
  });

  it('splitting a guessed entry, or moving it in bulk, is the user\'s word too; bulk Undo restores the guess', async () => {
    const { writer, fixture, capture, row } = await setup();
    const submit = createSubmitCapture({ suggester: fixture('cat_food') });
    const a = ok(await capture(submit, 1, { amountMinor: 10_000 })).value.transactionId;
    const b = ok(await capture(submit, 2, { amountMinor: 20_000 })).value.transactionId;
    ok(await writer.run(SetSplits, { transactionId: a, splits: [{ categoryId: 'cat_food', amountMinor: 6_000 }, { categoryId: 'cat_groceries', amountMinor: 4_000 }] }, 'user'));
    expect((await row(a)).slice(0, 2)).toEqual([0, 'user']);
    const moved = ok(await writer.run(BulkRecategorise, { transactionIds: [b], categoryId: 'cat_groceries' }, 'user'));
    expect((await row(b)).slice(0, 2)).toEqual([0, 'user']);
    ok(await writer.run(UndoBulkRecategorise, { previous: moved.value.previous }, 'user'));
    expect((await row(b)).slice(0, 2)).toEqual([1, 'suggester']);
  });
});

describe('a category the user set is never replaced by an automatic step (Story 4.4)', () => {
  it('ApplySuggestion refuses after the user chose, edited or confirmed the category, and writes nothing', async () => {
    const { writer, manual, fixture, capture, category, events } = await setup();
    const suggestion = { categoryId: 'cat_travel', reason: 'fixture' };
    // Chosen at save.
    const m = ok(await manual('cat_food', 1)).value.transactionId;
    // Edited from a guess.
    const e = ok(await capture(createSubmitCapture({ suggester: fixture('cat_food') }), 2)).value.transactionId;
    ok(await writer.run(EditTransaction, { transactionId: e, entry: { categoryId: 'cat_groceries' } }, 'user'));
    // Confirmed with Looks right.
    const c = ok(await capture(createSubmitCapture({ suggester: fixture('cat_food') }), 3)).value.transactionId;
    ok(await writer.run(ConfirmCategory, { transactionId: c }, 'user'));
    const assigned = (await events('CategoryAssigned')).length;
    for (const [id, was] of [[m, 'cat_food'], [e, 'cat_groceries'], [c, 'cat_food']] as const) {
      expect(await writer.run(ApplySuggestion, { transactionId: id, suggestion }, 'auto')).toMatchObject({ ok: false, code: 'CATEGORY_USER_SET' });
      expect(await category(id)).toBe(was);
    }
    expect((await events('CategoryAssigned')).length).toBe(assigned);
  });

  it('ApplySuggestion may refresh a guess nobody confirmed, and it stays a guess', async () => {
    const { writer, fixture, capture, row, category } = await setup();
    const id = ok(await capture(createSubmitCapture({ suggester: fixture('cat_food') }), 1)).value.transactionId;
    ok(await writer.run(ApplySuggestion, { transactionId: id, suggestion: { categoryId: 'cat_travel', reason: 'fixture' } }, 'auto'));
    expect(await category(id)).toBe('cat_travel');
    expect((await row(id)).slice(0, 2)).toEqual([1, 'suggester']);
  });

  it('a duplicate merge never swaps a category on its own: the user must choose, and what they choose stays theirs', async () => {
    const { writer, accountId, fixture, category, row } = await setup();
    const first = ok(await writer.run(SubmitCapture, { submissionId: 'man-d', sourceKind: 'manual', entry: { kind: 'expense', amountMinor: 45_000, categoryId: 'cat_food', accountId, merchant: 'Swiggy', occurredAtMs: at } }, 'user')).value.transactionId;
    const held = ok(await writer.run(createSubmitCapture({ suggester: fixture('cat_travel') }), { submissionId: 'sms-d', sourceKind: 'sms', entry: { kind: 'expense', amountMinor: 45_000, categoryId: UNCATEGORISED_ID, accountId, merchant: 'Swiggy', occurredAtMs: at + 60_000 } }, 'system'));
    expect(held.value.result).toBe('POSSIBLE_DUPLICATE');
    // The suggester said Travel for the held entry and the user set Food on the confirmed one: nothing is picked silently.
    expect(await writer.run(MergeDuplicate, { transactionId: held.value.transactionId }, 'user')).toMatchObject({ ok: false, code: 'CATEGORY_REQUIRED' });
    expect(await category(first)).toBe('cat_food');
    expect((await row(first)).slice(0, 2)).toEqual([0, 'user']);
    // The user's explicit choice is applied, and is theirs from then on (a guess is cleared).
    const merged = ok(await writer.run(MergeDuplicate, { transactionId: held.value.transactionId, categoryId: 'cat_food' }, 'user'));
    expect(await category(merged.value.survivorId)).toBe('cat_food');
    expect((await row(merged.value.survivorId)).slice(0, 2)).toEqual([0, 'user']);
  });
});
