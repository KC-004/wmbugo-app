import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { isLocalDate } from '../profile/period';
import { BILL_KINDS, CADENCES, CUSTOM_UNITS, isOccurrence, ruleOccurrences, type BillKind, type Cadence, type CustomUnit } from './recurring';
import { localToday, mapPayments, mapRules, RECURRING_RULE_SQL } from './recurringStore';

/** The commands on bill rules (Story 6.1). Each runs in one writer transaction with an audit row and `RecurringChanged`; none writes a transaction or moves a balance. */

export interface SaveRecurringRuleInput {
  /** Present when editing. */
  readonly id?: string;
  readonly title: string;
  readonly expectedAmountMinor: number;
  readonly cadence: Cadence;
  readonly customEvery?: number | null;
  readonly customUnit?: CustomUnit | null;
  /** The first due date (`Next due` in the editor). */
  readonly anchorDate: string;
  readonly accountId?: string | null;
  readonly categoryId?: string | null;
  readonly kind: BillKind;
  readonly paidTo?: string | null;
  readonly endsOn?: string | null;
  /** Remind me: 0 (on the day), 1 or 3 days before, null for Off. New bills start at 1 day before; an edit that leaves it out keeps what the bill had. */
  readonly remindDays?: 0 | 1 | 3 | null;
}

export type SaveRecurringRuleError =
  | 'TITLE_REQUIRED'
  | 'AMOUNT_REQUIRED'
  | 'DATE_REQUIRED'
  | 'DATE_INVALID'
  | 'END_BEFORE_START'
  | 'CADENCE_INVALID'
  | 'KIND_INVALID'
  | 'REMIND_INVALID'
  | 'ACCOUNT_NOT_FOUND'
  | 'CATEGORY_NOT_FOUND'
  | 'RULE_NOT_FOUND'
  | 'RULE_NOT_EDITABLE';

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
};

/** Adds a bill or edits one. Editing moves the anchor from the date given on; past payment rows keep their dates. */
export const SaveRecurringRule: UseCase<SaveRecurringRuleInput, { ruleId: string; created: boolean }, SaveRecurringRuleError> = {
  name: 'SaveRecurringRule',
  async execute(ctx, input) {
    const title = clean(input.title);
    if (title === null) return err('TITLE_REQUIRED');
    if (!Number.isSafeInteger(input.expectedAmountMinor) || input.expectedAmountMinor <= 0) return err('AMOUNT_REQUIRED');
    if (!input.anchorDate) return err('DATE_REQUIRED');
    if (!isLocalDate(input.anchorDate)) return err('DATE_INVALID');
    if (!(CADENCES as readonly string[]).includes(input.cadence)) return err('CADENCE_INVALID');
    const custom = input.cadence === 'custom';
    if (custom) {
      const n = input.customEvery;
      if (n === null || n === undefined || !Number.isInteger(n) || n < 1 || n > 99 || !input.customUnit || !(CUSTOM_UNITS as readonly string[]).includes(input.customUnit)) return err('CADENCE_INVALID');
    }
    if (!(BILL_KINDS as readonly string[]).includes(input.kind)) return err('KIND_INVALID');
    if (input.remindDays !== undefined && input.remindDays !== null && ![0, 1, 3].includes(input.remindDays)) return err('REMIND_INVALID');
    const endsOn = clean(input.endsOn);
    if (endsOn !== null) {
      if (!isLocalDate(endsOn)) return err('DATE_INVALID');
      if (endsOn < input.anchorDate) return err('END_BEFORE_START');
    }
    const accountId = clean(input.accountId);
    if (accountId !== null && (await ctx.query('SELECT 1 FROM account WHERE id = ?', [accountId])).length === 0) return err('ACCOUNT_NOT_FOUND');
    const categoryId = clean(input.categoryId);
    if (categoryId !== null && (await ctx.query('SELECT 1 FROM category WHERE id = ?', [categoryId])).length === 0) return err('CATEGORY_NOT_FOUND');

    const existing = input.id !== undefined ? mapRules(await ctx.query(RECURRING_RULE_SQL, [input.id]))[0] : undefined;
    if (input.id !== undefined && (!existing || existing.removedAt !== null)) return err('RULE_NOT_FOUND');
    if (existing && existing.endedAt !== null) return err('RULE_NOT_EDITABLE');

    const id = existing ? existing.id : ctx.newId();
    const remind = input.remindDays !== undefined ? input.remindDays : existing ? existing.remindDays : 1;
    const cols = [title, input.expectedAmountMinor, input.cadence, custom ? input.customEvery! : null, custom ? input.customUnit! : null, input.anchorDate, accountId, categoryId, input.kind, clean(input.paidTo), endsOn, remind] as const;
    if (existing) {
      await ctx.execute(
        'UPDATE recurring_rule SET title = ?, expected_amount_minor = ?, cadence = ?, custom_every = ?, custom_unit = ?, anchor_date = ?, account_id = ?, category_id = ?, kind = ?, paid_to = ?, ends_on = ?, remind_days = ? WHERE id = ?',
        [...cols, id],
      );
    } else {
      await ctx.execute(
        'INSERT INTO recurring_rule (id, title, expected_amount_minor, cadence, custom_every, custom_unit, anchor_date, account_id, category_id, kind, paid_to, ends_on, remind_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, ...cols, ctx.nowMs()],
      );
    }
    ctx.touch('recurring_rule', id, { ...(existing ? { edited: true } : { added: true }), label: title, cadence: input.cadence, kind: input.kind });
    ctx.emit('RecurringChanged', { ruleIds: [id] });
    return ok({ ruleId: id, created: !existing });
  },
};

type RuleError = 'RULE_NOT_FOUND' | 'NO_PROFILE';

async function activeRule(ctx: WriterContext, id: string) {
  const r = mapRules(await ctx.query(RECURRING_RULE_SQL, [id]))[0];
  return r && r.removedAt === null ? r : null;
}

/** Pauses a bill: no due dates from today until it resumes. History and payment rows stay. */
export const PauseRecurringRule: UseCase<{ ruleId: string }, void, RuleError | 'NOT_ACTIVE'> = {
  name: 'PauseRecurringRule',
  async execute(ctx, input) {
    const rule = await activeRule(ctx, input.ruleId);
    if (!rule) return err('RULE_NOT_FOUND');
    if (rule.pausedAt !== null || rule.endedAt !== null) return err('NOT_ACTIVE');
    const today = await localToday(ctx, ctx.nowMs());
    if (today === null) return err('NO_PROFILE');
    await ctx.execute('UPDATE recurring_rule SET paused_at = ?, paused_on = ? WHERE id = ?', [ctx.nowMs(), today, rule.id]);
    ctx.touch('recurring_rule', rule.id, { paused: true, label: rule.title });
    ctx.emit('RecurringChanged', { ruleIds: [rule.id] });
    return ok(undefined);
  },
};

/**
 * Resumes a paused bill. Its next due date is the first anchor occurrence on or after today; dates missed while it was
 * paused are never created, so none becomes `not_seen_yet`.
 */
export const ResumeRecurringRule: UseCase<{ ruleId: string }, void, RuleError | 'NOT_PAUSED'> = {
  name: 'ResumeRecurringRule',
  async execute(ctx, input) {
    const rule = await activeRule(ctx, input.ruleId);
    if (!rule) return err('RULE_NOT_FOUND');
    if (rule.pausedAt === null) return err('NOT_PAUSED');
    const today = await localToday(ctx, ctx.nowMs());
    if (today === null) return err('NO_PROFILE');
    await ctx.execute('UPDATE recurring_rule SET paused_at = NULL, resumed_on = ? WHERE id = ?', [today, rule.id]);
    ctx.touch('recurring_rule', rule.id, { resumed: true, label: rule.title });
    ctx.emit('RecurringChanged', { ruleIds: [rule.id] });
    return ok(undefined);
  },
};

/** Ends a bill: nothing falls due after today, and its history stays. */
export const EndRecurringRule: UseCase<{ ruleId: string }, void, RuleError | 'ALREADY_ENDED'> = {
  name: 'EndRecurringRule',
  async execute(ctx, input) {
    const rule = await activeRule(ctx, input.ruleId);
    if (!rule) return err('RULE_NOT_FOUND');
    if (rule.endedAt !== null) return err('ALREADY_ENDED');
    const today = await localToday(ctx, ctx.nowMs());
    if (today === null) return err('NO_PROFILE');
    await ctx.execute('UPDATE recurring_rule SET ended_at = ?, ended_on = ?, paused_at = NULL WHERE id = ?', [ctx.nowMs(), today, rule.id]);
    ctx.touch('recurring_rule', rule.id, { ended: true, label: rule.title });
    ctx.emit('RecurringChanged', { ruleIds: [rule.id] });
    return ok(undefined);
  },
};

/** Removes a bill that has no payment history. With any payment row it is refused (`HAS_PAYMENTS`): it can only be ended. */
export const RemoveRecurringRule: UseCase<{ ruleId: string }, void, RuleError | 'HAS_PAYMENTS'> = {
  name: 'RemoveRecurringRule',
  async execute(ctx, input) {
    const rule = await activeRule(ctx, input.ruleId);
    if (!rule) return err('RULE_NOT_FOUND');
    if ((await ctx.query('SELECT 1 FROM recurring_payment WHERE rule_id = ? LIMIT 1', [rule.id])).length > 0) return err('HAS_PAYMENTS');
    await ctx.execute('UPDATE recurring_rule SET removed_at = ? WHERE id = ?', [ctx.nowMs(), rule.id]);
    ctx.touch('recurring_rule', rule.id, { removed: true, label: rule.title });
    ctx.emit('RecurringChanged', { ruleIds: [rule.id] });
    return ok(undefined);
  },
};

/** Undo of a remove: the bill comes back as it was. */
export const RestoreRecurringRule: UseCase<{ ruleId: string }, void, 'RULE_NOT_FOUND'> = {
  name: 'RestoreRecurringRule',
  async execute(ctx, input) {
    const r = mapRules(await ctx.query(RECURRING_RULE_SQL, [input.ruleId]))[0];
    if (!r || r.removedAt === null) return err('RULE_NOT_FOUND');
    await ctx.execute('UPDATE recurring_rule SET removed_at = NULL WHERE id = ?', [r.id]);
    ctx.touch('recurring_rule', r.id, { restored: true, label: r.title });
    ctx.emit('RecurringChanged', { ruleIds: [r.id] });
    return ok(undefined);
  },
};

export type MarkBillPaidError = RuleError | 'NOT_A_DUE_DATE' | 'ALREADY_PAID';

/**
 * Marks one due date as paid without adding an entry (REC-004). The unique key on (rule, due date) makes a second payment
 * for the same date impossible; it is refused with `ALREADY_PAID` and nothing is written.
 */
export const MarkBillPaid: UseCase<{ ruleId: string; dueDate: string }, void, MarkBillPaidError> = {
  name: 'MarkBillPaid',
  async execute(ctx, input) {
    const rule = await activeRule(ctx, input.ruleId);
    if (!rule) return err('RULE_NOT_FOUND');
    if (!isLocalDate(input.dueDate) || !isOccurrence(rule, input.dueDate) || ruleOccurrences(rule, input.dueDate, input.dueDate).length === 0) return err('NOT_A_DUE_DATE');
    if ((await ctx.query('SELECT 1 FROM recurring_payment WHERE rule_id = ? AND due_date = ?', [rule.id, input.dueDate])).length > 0) return err('ALREADY_PAID');
    await ctx.execute("INSERT INTO recurring_payment (rule_id, due_date, payment_kind, transaction_id, recorded_at) VALUES (?, ?, 'marked', NULL, ?)", [rule.id, input.dueDate, ctx.nowMs()]);
    ctx.touch('recurring_payment', `${rule.id}:${input.dueDate}`, { marked: true, label: rule.title });
    ctx.emit('RecurringChanged', { ruleIds: [rule.id] });
    return ok(undefined);
  },
};

/** Takes back a `marked` payment (Undo, or a mistake). A linked payment is unlinked from its entry instead (Story 6.3). */
export const UnmarkBillPaid: UseCase<{ ruleId: string; dueDate: string }, void, 'RULE_NOT_FOUND' | 'NOT_MARKED'> = {
  name: 'UnmarkBillPaid',
  async execute(ctx, input) {
    const rule = mapRules(await ctx.query(RECURRING_RULE_SQL, [input.ruleId]))[0];
    if (!rule) return err('RULE_NOT_FOUND');
    const p = mapPayments(await ctx.query('SELECT rule_id, due_date, payment_kind, transaction_id, recorded_at FROM recurring_payment WHERE rule_id = ? AND due_date = ?', [input.ruleId, input.dueDate]))[0];
    if (!p || p.kind !== 'marked') return err('NOT_MARKED');
    await ctx.execute('DELETE FROM recurring_payment WHERE rule_id = ? AND due_date = ?', [input.ruleId, input.dueDate]);
    ctx.touch('recurring_payment', `${input.ruleId}:${input.dueDate}`, { unmarked: true, label: rule.title });
    ctx.emit('RecurringChanged', { ruleIds: [input.ruleId] });
    return ok(undefined);
  },
};
