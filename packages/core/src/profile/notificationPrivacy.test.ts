import { budgetAlertContent } from '../planning/budgetAlerts';
import { reminderContent } from '../planning/billReminders';
import type { NotificationContent, Notifier, ScheduledNotification } from '../ports/notifier';
import { unavailableNotifier } from '../ports/notifier';
import { FakeClock } from '../shared/clock';
import { createRedactingLogger } from '../shared/logger';
import { createIdGenerator, seededRandom } from '../shared/uuid';
import { NodeSqliteDatabase } from '../testing/nodeSqlite';
import { SetUpProfile } from '../usecases/setUpProfile';
import { LedgerWriter } from '../writer/ledgerWriter';
import {
  CAPTURE_HIDDEN_TITLE,
  decideNotificationForm,
  effectiveCaptureForm,
  hiddenCaptureNotification,
  widgetMayShowAmounts,
  withNotificationPrivacy,
  withShadeForm,
  type NotificationPrivacySettings,
} from './notificationPrivacy';
import { findRegion } from './regions';
import { DEFAULT_SETTINGS, parseSettings, SETTINGS_SQL } from './settings';
import { ChangeSetting, SetNotificationPrivacy } from './settingsCommands';

const base: NotificationPrivacySettings = { notificationDetail: 'full', fullNotificationsOptIn: false, appLockEnabled: false, hideAmounts: false };
const with_ = (over: Partial<NotificationPrivacySettings>): NotificationPrivacySettings => ({ ...base, ...over });

describe('decideNotificationForm: captures (matrix)', () => {
  const details = ['full', 'hidden'] as const;
  const bools = [false, true] as const;
  for (const notificationDetail of details)
    for (const appLockEnabled of bools)
      for (const hideAmounts of bools)
        for (const fullNotificationsOptIn of bools)
          for (const lockScreenApprove of bools) {
            const s = { notificationDetail, appLockEnabled, hideAmounts, fullNotificationsOptIn };
            const shadeHidden = notificationDetail === 'hidden' || ((appLockEnabled || hideAmounts) && !fullNotificationsOptIn);
            it(`detail ${notificationDetail}, lock ${appLockEnabled}, hide ${hideAmounts}, opt-in ${fullNotificationsOptIn}, lock-screen approve ${lockScreenApprove}`, () => {
              const f = decideNotificationForm('capture', s, lockScreenApprove);
              expect(f.shade).toBe(shadeHidden ? 'hidden' : 'full');
              // The lock screen is hidden unless the approve flag is true AND the shade form is full.
              expect(f.lockScreen).toBe(lockScreenApprove && !shadeHidden ? 'full' : 'hidden');
              // Approve and Reject only on a full form; a hidden form only offers Review.
              expect(f.actions).toEqual(shadeHidden ? ['review'] : ['approve', 'reject']);
            });
          }

  it('the lock-screen approve flag defaults to false: the lock screen is hidden by default', () => {
    expect(decideNotificationForm('capture', base).shade).toBe('full');
    expect(decideNotificationForm('capture', base).lockScreen).toBe('hidden');
  });

  it('the effective form drives the Privacy summary', () => {
    expect(effectiveCaptureForm(base)).toBe('full');
    expect(effectiveCaptureForm(with_({ appLockEnabled: true }))).toBe('hidden');
    expect(effectiveCaptureForm(with_({ appLockEnabled: true, fullNotificationsOptIn: true }))).toBe('full');
    expect(effectiveCaptureForm(with_({ notificationDetail: 'hidden', fullNotificationsOptIn: true }))).toBe('hidden');
  });
});

describe('decideNotificationForm: budgets and bills', () => {
  it('budget: public on the lock screen always, public in the shade while app lock or hide amounts is on', () => {
    expect(decideNotificationForm('budget', base)).toEqual({ shade: 'full', lockScreen: 'public', actions: [] });
    expect(decideNotificationForm('budget', with_({ appLockEnabled: true })).shade).toBe('public');
    expect(decideNotificationForm('budget', with_({ hideAmounts: true })).shade).toBe('public');
    expect(decideNotificationForm('budget', with_({ appLockEnabled: true, fullNotificationsOptIn: true })).shade).toBe('public');
  });

  it('bill: the lock screen is public, and the shade keeps the wording because it carries no money', () => {
    for (const s of [base, with_({ appLockEnabled: true }), with_({ hideAmounts: true, notificationDetail: 'hidden' })]) {
      expect(decideNotificationForm('bill', s)).toEqual({ shade: 'full', lockScreen: 'public', actions: [] });
    }
  });
});

describe('hidden capture notification and shade forms', () => {
  it('the hidden capture notification says New payment to check with no amount, merchant, account or category', () => {
    const n = hiddenCaptureNotification('cap-1');
    expect(n.title).toBe('New payment to check');
    expect(CAPTURE_HIDDEN_TITLE).toBe(n.title);
    expect(n.body).toBe('');
    expect(`${n.title} ${n.body} ${n.publicTitle} ${n.publicBody}`).not.toMatch(/\d|₹|merchant|account|category/i);
    expect(n.channel).toBe('capture_review');
    expect(n.data).toEqual({ screen: 'ReviewQueue' });
  });

  it('a public shade replaces the percentage with the public wording; a bill reminder keeps its words', () => {
    const budget = budgetAlertContent({ budgetId: 'b', periodStart: '2026-11-01', name: 'Groceries', thresholdPct: 90 });
    expect(budget.body).toBe('Groceries: 90% used this period');
    const hidden = withShadeForm(budget, 'public');
    expect(hidden.title).toBe('Budget update');
    expect(hidden.body).toBe('Tap to see');
    expect(`${hidden.title} ${hidden.body}`).not.toMatch(/90|Groceries/);
    const reminder = reminderContent({ id: 'r', remindOn: '2026-11-09', kind: 'bill', ruleId: 'x', title: 'Rent', dueDate: '2026-11-10', relation: 'tomorrow', moreCount: 0 });
    expect(withShadeForm(reminder, 'full').title).toBe('Rent is due tomorrow');
  });
});

describe('widgetMayShowAmounts', () => {
  it('is false whenever app lock or hide amounts is on', () => {
    expect(widgetMayShowAmounts({ appLockEnabled: false, hideAmounts: false })).toBe(true);
    expect(widgetMayShowAmounts({ appLockEnabled: true, hideAmounts: false })).toBe(false);
    expect(widgetMayShowAmounts({ appLockEnabled: false, hideAmounts: true })).toBe(false);
    expect(widgetMayShowAmounts({ appLockEnabled: true, hideAmounts: true })).toBe(false);
  });
});

describe('withNotificationPrivacy (the Notifier every feature posts through)', () => {
  function recorder() {
    const posted: NotificationContent[] = [];
    const scheduled: ScheduledNotification[][] = [];
    const inner: Notifier = {
      ...unavailableNotifier,
      available: true,
      post: async (c) => void posted.push(c),
      replaceScheduled: async (_ch, items) => void scheduled.push([...items]),
    };
    return { inner, posted, scheduled };
  }
  const alert = budgetAlertContent({ budgetId: 'b', periodStart: '2026-11-01', name: 'Groceries', thresholdPct: 90 });

  it('posts a budget alert with the percentage when nothing is guarded, and the public wording while app lock is on', async () => {
    const r = recorder();
    let settings = base;
    const n = withNotificationPrivacy(r.inner, async () => settings);
    await n.post(alert);
    settings = with_({ appLockEnabled: true });
    await n.post(alert);
    expect(r.posted[0]!.body).toBe('Groceries: 90% used this period');
    expect(r.posted[1]!.body).toBe('Tap to see');
  });

  it('re-posts what it posted in the new form when the settings change', async () => {
    const r = recorder();
    let settings = base;
    const n = withNotificationPrivacy(r.inner, async () => settings);
    await n.post(alert);
    settings = with_({ hideAmounts: true });
    await n.repostAll();
    expect(r.posted.map((p) => p.body)).toEqual(['Groceries: 90% used this period', 'Tap to see']);
    expect(r.posted[1]!.id).toBe(r.posted[0]!.id);
  });

  it('applies the form to scheduled reminders, keeping bill wording', async () => {
    const r = recorder();
    const n = withNotificationPrivacy(r.inner, async () => with_({ appLockEnabled: true }));
    const reminder = reminderContent({ id: 'r', remindOn: '2026-11-09', kind: 'bill', ruleId: 'x', title: 'Rent', dueDate: '2026-11-10', relation: 'tomorrow', moreCount: 0 });
    await n.replaceScheduled('bill_reminders', [{ content: reminder, atMs: 1 }]);
    expect(r.scheduled[0]![0]!.content.title).toBe('Rent is due tomorrow');
  });

  it('passes the permission calls and availability through', async () => {
    const r = recorder();
    const n = withNotificationPrivacy(r.inner, async () => base);
    expect(n.available).toBe(true);
    expect(await n.permission()).toBe('denied');
  });
});

describe('SetNotificationPrivacy', () => {
  async function setup() {
    const db = new NodeSqliteDatabase().applyRealMigrations();
    const clock = new FakeClock(Date.UTC(2026, 10, 8, 10, 0, 0), 'Asia/Singapore');
    const writer = new LedgerWriter({ uow: db, clock, newId: createIdGenerator(clock, seededRandom(3)), logger: createRedactingLogger({ write: () => undefined }), invariants: [] });
    await writer.run(SetUpProfile, { region: findRegion('SG')!, payday: { kind: 'first' }, budgetOffer: { answer: 'skipped' }, timezoneId: 'Asia/Singapore' }, 'user');
    return { db, writer };
  }

  it('defaults to full with no opt-in; stores both keys with an audit row naming keys only and ProfileChanged', async () => {
    const { db, writer } = await setup();
    expect(DEFAULT_SETTINGS.notificationDetail).toBe('full');
    expect(DEFAULT_SETTINGS.fullNotificationsOptIn).toBe(false);
    const r = await writer.run(SetNotificationPrivacy, { detail: 'hidden', fullOptIn: true }, 'user');
    expect(r.ok).toBe(true);
    expect(parseSettings(await db.query(SETTINGS_SQL))).toMatchObject({ notificationDetail: 'hidden', fullNotificationsOptIn: true });
    const audit = await db.query("SELECT change_json FROM audit_event WHERE kind = 'SetNotificationPrivacy'");
    expect(audit.length).toBe(2);
    for (const a of audit) expect(JSON.parse(String(a[0]))).toEqual({ changed: true });
    const events = await db.query("SELECT payload_json FROM outbox WHERE event = 'ProfileChanged'");
    expect(events.some((e) => String(e[0]).includes('privacy.notification_detail'))).toBe(true);
  });

  it('refuses a bad value or nothing to change, and the generic path', async () => {
    const { db, writer } = await setup();
    expect(await writer.run(SetNotificationPrivacy, { detail: 'loud' }, 'user')).toEqual({ ok: false, code: 'SETTING_INVALID' });
    expect(await writer.run(SetNotificationPrivacy, { fullOptIn: 'yes' }, 'user')).toEqual({ ok: false, code: 'SETTING_INVALID' });
    expect(await writer.run(SetNotificationPrivacy, {}, 'user')).toEqual({ ok: false, code: 'SETTING_INVALID' });
    expect(await writer.run(ChangeSetting, { key: 'privacy.notification_detail', value: 'hidden' }, 'user')).toEqual({ ok: false, code: 'SETTING_INVALID' });
    expect(parseSettings(await db.query(SETTINGS_SQL)).notificationDetail).toBe('full');
  });
});
