import {
  ACCOUNT_LIST_SQL,
  CATEGORY_LIST_SQL,
  billLinkOf,
  DismissBillMatch,
  EndRecurringRule,
  findBillMatch,
  linkCandidates,
  syncBillReminders,
  LinkBillPayment,
  UnlinkBillPayment,
  type BillMatch,
  type LinkCandidate,
  loadBillDetail,
  loadBillsList,
  mapAccountRows,
  mapCategoryRows,
  MarkBillPaid,
  PauseRecurringRule,
  RemoveRecurringRule,
  RestoreRecurringRule,
  ResumeRecurringRule,
  SaveRecurringRule,
  UnmarkBillPaid,
  type BillDetail,
  type BillsList,
  type CategoryRow,
  type CurrencyCode,
  type SaveRecurringRuleInput,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';
import { appNotifier } from '../../adapters/notifier';
import { requestPermission } from '../../adapters/permissions';
import { promptStateSeenStore } from '../home/homeApi';

export interface BillsData {
  readonly list: BillsList;
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly exponent: number;
  /** Active categories a bill can be filed under (spending and Both), top level and sub. */
  readonly categories: readonly CategoryRow[];
  /** Active accounts a bill is paid from: asset accounts and cards, not savings pots. */
  readonly accounts: readonly { id: string; name: string }[];
  /** Notifications are off for wmbugo: bill reminders keep their setting but nothing is scheduled (Story 6.5). */
  readonly notificationsDenied: boolean;
}

export interface BillDetailData {
  readonly detail: BillDetail;
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly exponent: number;
  readonly categories: readonly CategoryRow[];
  readonly accounts: readonly { id: string; name: string }[];
  readonly notificationsDenied: boolean;
}

/** What an entry's detail needs: the bill it pays, or the bill it looks like the payment of. */
export interface EntryBillState {
  readonly link: { ruleId: string; title: string; dueDate: string } | null;
  readonly match: BillMatch | null;
}

export type BillOutcome = { ok: true } | { ok: false; code: string };
export type SaveBillOutcome = { ok: true; value: { ruleId: string; created: boolean } } | { ok: false; code: string };

/** What the bills screens need. The real one reads through core and the writer; tests pass a fake. */
export interface BillsApi {
  load(): Promise<BillsData | null>;
  loadDetail(id: string): Promise<BillDetailData | 'missing' | null>;
  save(input: SaveRecurringRuleInput): Promise<SaveBillOutcome>;
  /** Undo of adding a bill. */
  remove(id: string): Promise<BillOutcome>;
  restore(id: string): Promise<BillOutcome>;
  pause(id: string): Promise<BillOutcome>;
  resume(id: string): Promise<BillOutcome>;
  end(id: string): Promise<BillOutcome>;
  markPaid(id: string, dueDate: string): Promise<BillOutcome>;
  unmarkPaid(id: string, dueDate: string): Promise<BillOutcome>;
  /** Story 6.3: the bill an entry pays, or the one it looks like paying. */
  forEntry(transactionId: string): Promise<EntryBillState>;
  link(ruleId: string, dueDate: string, transactionId: string): Promise<BillOutcome>;
  unlink(transactionId: string): Promise<BillOutcome>;
  /** `Not this one`. */
  dismissMatch(ruleId: string, transactionId: string): Promise<BillOutcome>;
  candidates(ruleId: string, dueDate: string, search: string): Promise<readonly LinkCandidate[]>;
  /** Story 6.5: whether to make the one-time reminder ask (notifier can post, permission undetermined, never asked before). */
  shouldAskForReminders?(): Promise<boolean>;
  /** Records the ask as answered (never repeated) and, for Allow, shows the system prompt and schedules the reminders. */
  answerReminderAsk?(allow: boolean): Promise<void>;
}

/** The prompt_state key of the one-time bill reminder ask; recorded for Allow and Not now so it never repeats. */
export const REMINDER_ASK_KEY = 'bills.reminder-ask';

export const entryBillKey = (transactionId: string) => ['bills', 'entry', transactionId] as const;

export const BILLS_QUERY_KEY = ['bills', 'list'] as const;
export const billDetailKey = (id: string) => ['bills', 'detail', id] as const;

async function pickers() {
  const db = getServices().db;
  return {
    notificationsDenied: appNotifier.available && (await appNotifier.permission()) === 'denied',
    categories: mapCategoryRows(await db.query(CATEGORY_LIST_SQL)).filter((c) => c.kind !== 'income'),
    accounts: mapAccountRows(await db.query(ACCOUNT_LIST_SQL))
      .filter((a) => a.status === 'active' && a.type !== 'savings_pot')
      .map((a) => ({ id: a.id, name: a.name })),
  };
}

const run = async (r: Promise<{ ok: true } | { ok: false; code: string }>): Promise<BillOutcome> => {
  const x = await r;
  return x.ok ? { ok: true } : { ok: false, code: x.code };
};

export const realBillsApi: BillsApi = {
  async load() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const list = await loadBillsList(db, systemClock.nowMs());
    if (!list) return null;
    return { list, currency: p.currency, locale: p.locale, exponent: p.exponent, ...(await pickers()) };
  },
  async loadDetail(id) {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const detail = await loadBillDetail(db, systemClock.nowMs(), id);
    if (detail === null || detail === 'missing') return detail;
    return { detail, currency: p.currency, locale: p.locale, exponent: p.exponent, ...(await pickers()) };
  },
  async save(input) {
    const r = await getServices().writer.run(SaveRecurringRule, input, 'user');
    return r.ok ? { ok: true, value: r.value } : { ok: false, code: r.code };
  },
  remove: (id) => run(getServices().writer.run(RemoveRecurringRule, { ruleId: id }, 'user')),
  restore: (id) => run(getServices().writer.run(RestoreRecurringRule, { ruleId: id }, 'user')),
  pause: (id) => run(getServices().writer.run(PauseRecurringRule, { ruleId: id }, 'user')),
  resume: (id) => run(getServices().writer.run(ResumeRecurringRule, { ruleId: id }, 'user')),
  end: (id) => run(getServices().writer.run(EndRecurringRule, { ruleId: id }, 'user')),
  markPaid: (id, dueDate) => run(getServices().writer.run(MarkBillPaid, { ruleId: id, dueDate }, 'user')),
  async forEntry(transactionId) {
    const db = getServices().db;
    const link = await billLinkOf(db, transactionId);
    return { link, match: link ? null : await findBillMatch(db, transactionId) };
  },
  link: (ruleId, dueDate, transactionId) => run(getServices().writer.run(LinkBillPayment, { ruleId, dueDate, transactionId }, 'user')),
  unlink: (transactionId) => run(getServices().writer.run(UnlinkBillPayment, { transactionId }, 'user')),
  dismissMatch: (ruleId, transactionId) => run(getServices().writer.run(DismissBillMatch, { ruleId, transactionId }, 'user')),
  async shouldAskForReminders() {
    if (!appNotifier.available) return false;
    if ((await appNotifier.permission()) !== 'undetermined') return false;
    return !(await promptStateSeenStore.hasSeen(REMINDER_ASK_KEY));
  },
  async answerReminderAsk(allow) {
    await promptStateSeenStore.markSeen(REMINDER_ASK_KEY);
    if (allow) {
      await requestPermission('notifications');
      await syncBillReminders(getServices().db, appNotifier, systemClock.nowMs());
    }
  },
  candidates: (ruleId, dueDate, search) => linkCandidates(getServices().db, ruleId, dueDate, search),
  unmarkPaid: (id, dueDate) => run(getServices().writer.run(UnmarkBillPaid, { ruleId: id, dueDate }, 'user')),
};
