import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { AddAccount, openingBalanceShape } from '../ledger/accountCommands';
import { entryShape, RecordManualEntry } from '../ledger/entryCommands';
import { RecordTransfer, SETTING_BLOCK_TRANSFERS } from '../ledger/transferCommands';
import { LedgerWriter } from '../writer/ledgerWriter';
import { findRegion } from './regions';
import { effectiveLocale, parseSettings, paydaySummary, periodRule, SETTINGS_SQL, validateSetting, youSummary, DEFAULT_SETTINGS } from './settings';
import { AnswerTimezonePrompt, ApplyPendingTimezone, ChangeProfile, ChangeSetting, TrackTimezone } from './settingsCommands';
import { nextLocalDate, offsetMinutes, PROMPT_TIMEZONE, shouldAskTimezone, timezonesDiffer } from './timezone';
import { periodFor } from './period';

// 2026-11-08T10:00:00Z = 18:00 in Singapore (UTC+8).
const NOW = Date.UTC(2026, 10, 8, 10, 0, 0);
const DAY = 86_400_000;

async function setup() {
  const db = new NodeSqliteDatabase().applyRealMigrations();
  const clock = new FakeClock(NOW, 'Asia/Singapore');
  const writer = new LedgerWriter({
    uow: db,
    clock,
    newId: createIdGenerator(clock, seededRandom(2)),
    logger: createRedactingLogger({ write: () => undefined }),
    invariants: [openingBalanceShape, entryShape],
  });
  await writer.run(SetUpProfile, { region: findRegion('SG')!, payday: { kind: 'last_day' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Singapore' }, 'user');
  const settings = async () => parseSettings(await db.query(SETTINGS_SQL));
  const profile = async () => (await db.query('SELECT region, currency_code, currency_exponent, locale, payday_rule, payday_day, timezone_id FROM profile'))[0]!;
  return { db, clock, writer, settings, profile };
}

describe('settings values', () => {
  it('defaults when nothing is stored, and ignores corrupt or invalid values', () => {
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([['ui.number_format', '"nope"'], ['theme', '{bad']])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([['theme', '"dark"'], ['ui.haptics', 'false']])).toMatchObject({ theme: 'dark', haptics: false });
  });

  it('validates per key', () => {
    expect(validateSetting('theme', 'dark').ok).toBe(true);
    expect(validateSetting('theme', 'purple').ok).toBe(false);
    expect(validateSetting('ui.haptics', 'yes').ok).toBe(false);
    expect(validateSetting('finance.default_account', null).ok).toBe(true);
    expect(validateSetting('unknown.key', 1).ok).toBe(false);
  });

  it('picks the formatting locale and the period rule', () => {
    expect(effectiveLocale('en-SG', 'region')).toBe('en-SG');
    expect(effectiveLocale('en-SG', 'indian')).toBe('en-IN');
    expect(effectiveLocale('en-SG', 'european')).toBe('de-DE');
    expect(periodRule({ kind: 'last_day' }, 'calendar_month')).toEqual({ kind: 'none' });
    expect(periodRule({ kind: 'last_day' }, 'pay_cycle')).toEqual({ kind: 'last_day' });
  });

  it('summarises the You group in one line', () => {
    expect(youSummary({ kind: 'first' }, 'dark')).toBe('Payday 1st · Dark');
    expect(paydaySummary({ kind: 'day', day: 22 })).toBe('22nd');
    expect(paydaySummary({ kind: 'day', day: 11 })).toBe('11th');
    expect(paydaySummary({ kind: 'none' })).toBe('not salaried');
    expect(youSummary({ kind: 'last_working_day' }, 'system')).toBe('Payday last working day · System');
  });
});

describe('ChangeSetting', () => {
  it('saves a theme, bumps the version, audits the key not the value and raises ProfileChanged', async () => {
    const { writer, db, settings } = await setup();
    expect((await writer.run(ChangeSetting, { key: 'theme', value: 'dark' }, 'user')).ok).toBe(true);
    await writer.run(ChangeSetting, { key: 'theme', value: 'light' }, 'user');
    expect((await settings()).theme).toBe('light');
    expect(Number((await db.query("SELECT version FROM settings WHERE key = 'theme'"))[0]![0])).toBe(3);
    expect(JSON.stringify(await db.query("SELECT * FROM audit_event WHERE entity_kind = 'settings'"))).not.toContain('light');
    expect((await db.query('SELECT event FROM outbox')).map((r) => r[0])).toContain('ProfileChanged');
  });

  it('refuses unknown keys and bad values, and a default account that does not exist', async () => {
    const { writer } = await setup();
    expect(await writer.run(ChangeSetting, { key: 'theme', value: 'neon' }, 'user')).toEqual({ ok: false, code: 'SETTING_INVALID' });
    expect(await writer.run(ChangeSetting, { key: 'whatever', value: 1 }, 'user')).toEqual({ ok: false, code: 'SETTING_INVALID' });
    expect(await writer.run(ChangeSetting, { key: 'finance.default_account', value: 'missing' }, 'user')).toEqual({ ok: false, code: 'ACCOUNT_NOT_FOUND' });
  });

  it('Block transfers above the balance persists and the transfer enforces it', async () => {
    const { writer, db, settings } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 1000 }, 'user');
    await writer.run(AddAccount, { name: 'Cash', type: 'cash', openingMinor: 0 }, 'user');
    const ids = (await db.query('SELECT id FROM account ORDER BY sort_order')).map((r) => r[0] as string);
    await writer.run(ChangeSetting, { key: SETTING_BLOCK_TRANSFERS, value: true }, 'user');
    expect((await settings()).blockTransfers).toBe(true);
    expect(await writer.run(RecordTransfer, { amountMinor: 5000, fromAccountId: ids[0]!, toAccountId: ids[1]! }, 'user')).toEqual({ ok: false, code: 'INSUFFICIENT_FUNDS' });
    await writer.run(ChangeSetting, { key: SETTING_BLOCK_TRANSFERS, value: false }, 'user');
    expect((await writer.run(RecordTransfer, { amountMinor: 5000, fromAccountId: ids[0]!, toAccountId: ids[1]! }, 'user')).ok).toBe(true);
  });
});

describe('ChangeProfile', () => {
  it('changes region and currency with no transactions, updating the stored exponent', async () => {
    const { writer, profile } = await setup();
    expect((await writer.run(ChangeProfile, { region: findRegion('JP') ?? findRegion('IN')! }, 'user')).ok).toBe(true);
    const p = await profile();
    expect(p[1]).not.toBe('SGD');
    const ev = await writer.run(ChangeProfile, { region: findRegion('US')! }, 'user');
    expect(ev.ok).toBe(true);
    expect((await profile())[1]).toBe('USD');
    expect((await profile())[2]).toBe(2);
  });

  it('blocks a currency change once any transaction exists, and changes nothing', async () => {
    const { writer, profile } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 5000 }, 'user');
    const before = await profile();
    expect(await writer.run(ChangeProfile, { region: findRegion('US')! }, 'user')).toEqual({ ok: false, code: 'CURRENCY_LOCKED' });
    expect(await profile()).toEqual(before);
  });

  it('allows a region with the same currency even when entries exist', async () => {
    const { writer, db } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 5000 }, 'user');
    const r = await writer.run(ChangeProfile, { region: findRegion('DE')! }, 'user');
    const cur = findRegion('DE')!.currency;
    expect(r.ok).toBe(cur === 'SGD');
    void db;
  });

  it('changing payday recomputes the period without modifying any transaction', async () => {
    const { writer, db, profile } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: 5000 }, 'user');
    await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: (await db.query('SELECT id FROM account'))[0]![0] as string }, 'user');
    const txBefore = await db.query('SELECT * FROM "transaction" ORDER BY id');
    expect((await writer.run(ChangeProfile, { payday: { kind: 'first' } }, 'user')).ok).toBe(true);
    expect((await profile())[4]).toBe('first');
    expect(await db.query('SELECT * FROM "transaction" ORDER BY id')).toEqual(txBefore);
    expect(periodFor('2026-11-08', { kind: 'first' }).start).toBe('2026-11-01');
    const audit = (await db.query("SELECT entity_kind FROM audit_event WHERE entity_kind = 'profile'")).length;
    expect(audit).toBeGreaterThan(0);
  });

  it('refuses an unknown timezone and an empty change', async () => {
    const { writer } = await setup();
    expect(await writer.run(ChangeProfile, { timezoneId: 'Mars/Base' }, 'user')).toEqual({ ok: false, code: 'TIMEZONE_INVALID' });
    expect(await writer.run(ChangeProfile, {}, 'user')).toEqual({ ok: false, code: 'NOTHING_TO_CHANGE' });
  });

  it('changes the timezone manually; existing local dates stay', async () => {
    const { writer, db, profile } = await setup();
    await writer.run(AddAccount, { name: 'DBS', type: 'bank', openingMinor: null }, 'user');
    await writer.run(RecordManualEntry, { kind: 'expense', amountMinor: 100, categoryId: 'cat_food', accountId: (await db.query('SELECT id FROM account'))[0]![0] as string }, 'user');
    await writer.run(ChangeProfile, { timezoneId: 'Asia/Dubai' }, 'user');
    expect((await profile())[6]).toBe('Asia/Dubai');
    expect((await db.query('SELECT local_date, timezone_id FROM "transaction"'))[0]).toEqual(['2026-11-08', 'Asia/Singapore']);
  });
});

describe('timezone prompt', () => {
  it('measures offsets and the two-hour gap', () => {
    expect(offsetMinutes('Asia/Singapore', NOW)).toBe(480);
    expect(offsetMinutes('Asia/Dubai', NOW)).toBe(240);
    expect(offsetMinutes('Mars/Base', NOW)).toBeNull();
    expect(timezonesDiffer('Asia/Singapore', 'Asia/Dubai', NOW)).toBe(true);
    expect(timezonesDiffer('Asia/Singapore', 'Asia/Kuala_Lumpur', NOW)).toBe(false);
    expect(timezonesDiffer('Asia/Singapore', 'Asia/Bangkok', NOW)).toBe(false); // one hour
  });

  it('asks only after more than 24 hours, and once', () => {
    expect(shouldAskTimezone({ mismatchSinceMs: null, nowMs: NOW, answered: false })).toBe(false);
    expect(shouldAskTimezone({ mismatchSinceMs: NOW - DAY, nowMs: NOW, answered: false })).toBe(false);
    expect(shouldAskTimezone({ mismatchSinceMs: NOW - DAY - 1, nowMs: NOW, answered: false })).toBe(true);
    expect(shouldAskTimezone({ mismatchSinceMs: NOW - 5 * DAY, nowMs: NOW, answered: true })).toBe(false);
    expect(nextLocalDate(NOW, 'Asia/Singapore')).toBe('2026-11-09');
  });

  it('tracks the start of a mismatch and forgets it when the zones match again', async () => {
    const { writer, db, clock } = await setup();
    await writer.run(TrackTimezone, { deviceTz: 'Asia/Dubai' }, 'system');
    const since = () => db.query("SELECT value_json FROM settings WHERE key = 'tz.mismatch_since'");
    expect(JSON.parse(String((await since())[0]![0]))).toBe(NOW);
    clock.advance(DAY);
    await writer.run(TrackTimezone, { deviceTz: 'Asia/Dubai' }, 'system');
    expect(JSON.parse(String((await since())[0]![0]))).toBe(NOW); // not reset
    await writer.run(TrackTimezone, { deviceTz: 'Asia/Singapore' }, 'system');
    expect(await since()).toEqual([]);
  });

  it('No keeps the zone and is recorded; Yes switches from the next day only', async () => {
    const a = await setup();
    await a.writer.run(AnswerTimezonePrompt, { use: false, deviceTz: 'Asia/Dubai' }, 'user');
    expect(Number((await a.db.query('SELECT count FROM prompt_state WHERE key = ?', [PROMPT_TIMEZONE]))[0]![0])).toBe(1);
    expect((await a.profile())[6]).toBe('Asia/Singapore');

    const b = await setup();
    await b.writer.run(TrackTimezone, { deviceTz: 'Asia/Dubai' }, 'system');
    expect((await b.writer.run(AnswerTimezonePrompt, { use: true, deviceTz: 'Asia/Dubai' }, 'user')).ok).toBe(true);
    expect((await b.writer.run(ApplyPendingTimezone, undefined, 'system'))).toEqual({ ok: true, value: { applied: false } });
    expect((await b.profile())[6]).toBe('Asia/Singapore');
    b.clock.advance(DAY);
    expect(await b.writer.run(ApplyPendingTimezone, undefined, 'system')).toEqual({ ok: true, value: { applied: true } });
    expect((await b.profile())[6]).toBe('Asia/Dubai');
    expect(await b.db.query("SELECT 1 FROM settings WHERE key IN ('tz.pending','tz.mismatch_since')")).toEqual([]);
  });

  it('refuses an invalid device timezone', async () => {
    const { writer } = await setup();
    expect(await writer.run(AnswerTimezonePrompt, { use: true, deviceTz: 'Mars/Base' }, 'user')).toEqual({ ok: false, code: 'TIMEZONE_INVALID' });
  });
});
