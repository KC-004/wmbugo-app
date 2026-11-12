import {
  ACCOUNT_LIST_SQL,
  CATEGORY_LIST_SQL,
  loadBudgetDetail,
  loadBudgetList,
  RemoveBudget,
  RestoreBudget,
  type BudgetDetail,
  type EditableBudget,
  mapAccountRows,
  mapCategoryRows,
  periodRule,
  readBudgetForEdit,
  SaveBudget,
  UndoSaveBudget,
  type BudgetList,
  type BudgetSnapshot,
  type CategoryRow,
  type CurrencyCode,
  type SaveBudgetInput,
} from '@wmbugo/core';
import { getServices, systemClock } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';
import { appNotifier } from '../../adapters/notifier';
import { promptStateSeenStore } from '../home/homeApi';

export interface BudgetsData {
  readonly list: BudgetList;
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly exponent: number;
  /** The profile counts by pay cycle (true) or by calendar month (false): the wording of `Each pay cycle` / `Each month`. */
  readonly payCycle: boolean;
  /** Active categories a budget can cover: spending and Both, with their subcategories. */
  readonly categories: readonly CategoryRow[];
  readonly accounts: readonly { id: string; name: string }[];
}

export type { EditableBudget };

export interface BudgetDetailData {
  readonly detail: BudgetDetail;
  readonly currency: CurrencyCode;
  readonly locale: string;
  readonly exponent: number;
}

export type SaveBudgetOutcome =
  | { ok: true; value: { budgetId: string; created: boolean; snapshot: BudgetSnapshot | null } }
  | { ok: false; code: string };

/** What the Plan tab's budget list needs. The real one reads through the ledger and the writer; tests pass a fake. */
export interface BudgetsApi {
  load(): Promise<BudgetsData | null>;
  readForEdit(id: string): Promise<EditableBudget | null>;
  save(input: SaveBudgetInput): Promise<SaveBudgetOutcome>;
  /** One budget for a period: `back` is how many periods before the current one. 'missing' when it was deleted. */
  loadDetail(id: string, back: number | string): Promise<BudgetDetailData | 'missing' | null>;
  remove(id: string): Promise<{ ok: boolean }>;
  restore(id: string): Promise<{ ok: boolean }>;
  /** Whether to offer the one-time notification ask: the notifier can post, permission was never asked, and this ask was never shown. */
  shouldAskForAlerts?(): Promise<boolean>;
  /** Records the ask as answered (never repeated) and, for Allow, shows the system prompt. */
  answerAlertAsk?(allow: boolean): Promise<void>;
  undo(value: { budgetId: string; created: boolean; snapshot: BudgetSnapshot }): Promise<{ ok: boolean }>;
}

export const BUDGETS_QUERY_KEY = ['budgets', 'list'] as const;

/** The prompt_state key of the one-time ask; recorded for Allow and for Not now, so it never repeats. */
export const ALERT_ASK_KEY = 'budgets.alerts-ask';

export const realBudgetsApi: BudgetsApi = {
  async load() {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const list = await loadBudgetList(db, systemClock.nowMs());
    if (!list) return null;
    return {
      list,
      currency: p.currency,
      locale: p.locale,
      exponent: p.exponent,
      payCycle: periodRule(p.payday, p.settings.periodMode).kind !== 'none',
      categories: mapCategoryRows(await db.query(CATEGORY_LIST_SQL)).filter((c) => c.kind !== 'income'),
      accounts: mapAccountRows(await db.query(ACCOUNT_LIST_SQL)).filter((a) => a.status === 'active').map((a) => ({ id: a.id, name: a.name })),
    };
  },
  readForEdit: (id) => readBudgetForEdit(getServices().db, id, systemClock.nowMs()),
  async loadDetail(id, back) {
    const db = getServices().db;
    const p = await readProfile(db);
    if (!p) return null;
    const detail = await loadBudgetDetail(db, id, back, systemClock.nowMs());
    if (detail === null || detail === 'missing') return detail;
    return { detail, currency: p.currency, locale: p.locale, exponent: p.exponent };
  },
  async shouldAskForAlerts() {
    if (!appNotifier.available) return false;
    if ((await appNotifier.permission()) !== 'undetermined') return false;
    return !(await promptStateSeenStore.hasSeen(ALERT_ASK_KEY));
  },
  async answerAlertAsk(allow) {
    await promptStateSeenStore.markSeen(ALERT_ASK_KEY);
    if (allow) await appNotifier.requestPermission();
  },
  remove: (id) => getServices().writer.run(RemoveBudget, { budgetId: id }, 'user'),
  restore: (id) => getServices().writer.run(RestoreBudget, { budgetId: id }, 'user'),
  async save(input) {
    const r = await getServices().writer.run(SaveBudget, input, 'user');
    return r.ok ? { ok: true, value: r.value } : { ok: false, code: r.code };
  },
  undo: (value) => getServices().writer.run(UndoSaveBudget, value, 'user'),
};
