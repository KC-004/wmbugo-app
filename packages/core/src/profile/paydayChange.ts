import { toLocalDate } from '../shared/clock';
import type { SqlParam } from '../ports/storage';
import type { PaydayRule, PaydayRuleBase, PaydayTransition } from './payday';
import { isValidPayday } from './payday';
import { paydayRuleFromRow, planPaydayChange, type PaydayChangePlan } from './period';
import { SETTINGS_SQL } from './settings';

/** Where payday changes are kept (a JSON list, oldest first). They are never removed: past periods depend on them. */
export const SETTING_PAYDAY_TRANSITIONS = 'finance.payday_transitions';

interface Querier {
  query(sql: string, params?: readonly SqlParam[]): Promise<SqlParam[][]>;
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function asBase(v: unknown): PaydayRuleBase | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { kind?: unknown; day?: unknown };
  const rule = o.kind === 'day' ? { kind: 'day' as const, day: Number(o.day) } : typeof o.kind === 'string' ? ({ kind: o.kind } as PaydayRuleBase) : null;
  return rule && isValidPayday(rule) ? rule : null;
}

/** The stored payday changes from the settings rows, ignoring anything unreadable. */
export function parsePaydayTransitions(settingsRows: readonly (readonly unknown[])[]): PaydayTransition[] {
  const row = settingsRows.find((r) => String(r[0]) === SETTING_PAYDAY_TRANSITIONS);
  if (!row) return [];
  try {
    const list: unknown = JSON.parse(String(row[1]));
    if (!Array.isArray(list)) return [];
    const out: PaydayTransition[] = [];
    for (const t of list as { start?: unknown; end?: unknown; previous?: unknown; normalDays?: unknown }[]) {
      const previous = asBase(t.previous);
      if (isDate(t.start) && isDate(t.end) && previous && typeof t.normalDays === 'number' && t.normalDays > 0) out.push({ start: t.start, end: t.end, previous, normalDays: t.normalDays });
    }
    return out.sort((a, b) => a.start.localeCompare(b.start));
  } catch {
    return [];
  }
}

/** The payday rule with the history of its changes, which is what the period service needs. */
export function paydayWithHistory(rule: PaydayRuleBase, settingsRows: readonly (readonly unknown[])[]): PaydayRule {
  const transitions = parsePaydayTransitions(settingsRows);
  return transitions.length > 0 ? { ...rule, transitions } : rule;
}

/** Profile payday and its changes, read the same way everywhere. null when there is no profile. */
export async function readPaydayRule(q: Querier): Promise<{ rule: PaydayRule; timezoneId: string } | null> {
  const p = (await q.query('SELECT payday_rule, payday_day, timezone_id FROM profile LIMIT 1'))[0];
  if (!p) return null;
  const base = paydayRuleFromRow(p[0] === null ? null : String(p[0]), p[1] === null ? null : Number(p[1]));
  return { rule: paydayWithHistory(base, await q.query(SETTINGS_SQL)), timezoneId: String(p[2]) };
}

/** The 1st is day 1 and the last day is day 31 (a day that a short month lacks falls on its last day), so those pairs are the same payday. */
const canonical = (r: PaydayRuleBase): string => (r.kind === 'first' ? 'day:1' : r.kind === 'last_day' ? 'day:31' : r.kind === 'day' ? `day:${r.day}` : r.kind);

export const samePayday = (a: PaydayRuleBase, b: PaydayRuleBase): boolean => canonical(a) === canonical(b);

/**
 * What a payday change would do today, for the confirmation (`Your current cycle will end on 24 Nov`). Read only.
 * null when payday is not changing or the new rule is not a pay cycle.
 */
export async function previewPaydayChange(q: Querier, next: PaydayRuleBase, nowMs: number): Promise<PaydayChangePlan | null> {
  const read = await readPaydayRule(q);
  if (!read || next.kind === 'none' || samePayday(read.rule, next)) return null;
  const today = toLocalDate(nowMs, read.timezoneId);
  if (!today.ok) return null;
  return planPaydayChange(today.value, read.rule, next);
}
