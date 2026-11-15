import {
  ACCOUNT_LIST_SQL,
  CATEGORY_LIST_SQL,
  billLinkOf,
  DismissBillMatch,
  EndRecurringRule,
  findBillMatch,
  linkCandidates,
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

export interface BillsData {
  readonly list: BillsList;
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly exponent: number;
  /** Active categories a bill can be filed under (spending and Both), top level and sub. */
  readonly categories: readonly CategoryRow[];
  /** Active accounts a bill is paid from: asset accounts and cards, not savings pots. */
  readonly accounts: readonly { id: string; name: string }[];
}

export interface BillDetailData {
  readonly detail: BillDetail;
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly exponent: number;
  readonly categories: readonly CategoryRow[];
  readonly accounts: readonly { id: string; name: string }[];
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
}

export const entryBillKey = (transactionId: string) => ['bills', 'entry', transactionId] as const;

export const BILLS_QUERY_KEY = ['bills', 'list'] as const;
export const billDetailKey = (id: string) => ['bills', 'detail', id] as const;

async function pickers() {
  const db = getServices().db;
  return {
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
  candidates: (ruleId, dueDate, search) => linkCandidates(getServices().db, ruleId, dueDate, search),
  unmarkPaid: (id, dueDate) => run(getServices().writer.run(UnmarkBillPaid, { ruleId: id, dueDate }, 'user')),
};
