import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { kindsOverlap, UNCATEGORISED_ID, type BudgetType, type CategoryKind } from './categories';

/** The 12 categorical colours of the design system (DESIGN.md `cat-*`). There is no free colour entry. */
export const CATEGORY_COLOURS = [
  'cat-rose', 'cat-pink', 'cat-fuchsia', 'cat-indigo', 'cat-sky', 'cat-cyan',
  'cat-emerald', 'cat-lime', 'cat-olive', 'cat-brown', 'cat-stone', 'cat-slate',
] as const;
export type CategoryColour = (typeof CATEGORY_COLOURS)[number];

export const CATEGORY_NAME_MAX = 30;

export type CategoryNameError = 'NAME_REQUIRED' | 'NAME_TOO_LONG';

export function validateCategoryName(raw: string): { ok: true; value: string } | { ok: false; code: CategoryNameError } {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value === '') return { ok: false, code: 'NAME_REQUIRED' };
  if ([...value].length > CATEGORY_NAME_MAX) return { ok: false, code: 'NAME_TOO_LONG' };
  return { ok: true, value };
}

/** Names compare ignoring case and surrounding spaces. */
export const sameCategoryName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface SaveCategoryInput {
  /** Present when editing an existing category. */
  readonly id?: string;
  readonly name: string;
  /** What it is used for (Story 4.2). Ignored for a subcategory, which always takes its parent's kind. */
  readonly kind: CategoryKind;
  /** A Phosphor icon name from the app's grid. */
  readonly icon: string;
  readonly colour: string;
  /** `null` is "Not set" (counts as Not classified in 50/30/20). Only spending categories have a type. */
  readonly budgetType: BudgetType | null;
  /** Adding only: the top-level spending category this is a subcategory of. */
  readonly parentId?: string | null;
}

export type SaveCategoryError =
  | CategoryNameError
  | 'NAME_TAKEN'
  | 'COLOUR_INVALID'
  | 'ICON_INVALID'
  | 'TYPE_INVALID'
  | 'PARENT_INVALID'
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_READONLY'
  | KindInUse;

type Side = 'income' | 'spending';

/** A kind change refused because entries of the side being left use the category, e.g. `KIND_IN_USE:income:3`. */
export type KindInUse = `KIND_IN_USE:${Side}:${number}`;

export function parseKindInUse(code: string): { side: Side; count: number } | null {
  const m = /^KIND_IN_USE:(income|spending):(\d+)$/.exec(code);
  return m ? { side: m[1] as Side, count: Number(m[2]) } : null;
}

const SIDES: Readonly<Record<CategoryKind, readonly Side[]>> = { expense: ['spending'], income: ['income'], mixed: ['spending', 'income'] };

/** Entries (this category and its subcategories) of one side. Params: category id twice. */
const USE_BY_SIDE_SQL = (side: Side) =>
  `SELECT COUNT(DISTINCT s.transaction_id) FROM split s JOIN "transaction" t ON t.id = s.transaction_id JOIN category c ON c.id = s.category_id WHERE (c.id = ? OR c.parent_id = ?) AND t.event_type ${side === 'income' ? "= 'income'" : "IN ('expense', 'refund')"}`;

interface Existing {
  readonly id: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly budgetType: BudgetType | null;
  readonly icon: string;
  readonly colour: string;
  readonly parentId: string | null;
  readonly archived: boolean;
}

async function loadCategories(ctx: WriterContext): Promise<Existing[]> {
  const rows = await ctx.query('SELECT id, name, kind, budget_type, icon, color_token, parent_id, archived FROM category ORDER BY sort_order, id');
  return rows.map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    kind: String(r[2]) as CategoryKind,
    budgetType: r[3] === null ? null : (String(r[3]) as BudgetType),
    icon: String(r[4]),
    colour: String(r[5]),
    parentId: r[6] === null ? null : String(r[6]),
    archived: Number(r[7]) === 1,
  }));
}

/**
 * Adds a category, or edits one by id (Story 4.1, CAT-001/CAT-002). Only the category row changes: no entry, split or
 * posting is touched, so every amount and every past total stays exactly as it was. The audit row holds the old and new
 * values. `Uncategorised` is the system fallback and cannot be edited.
 */
export const SaveCategory: UseCase<SaveCategoryInput, { categoryId: string }, SaveCategoryError> = {
  name: 'SaveCategory',
  async execute(ctx, input) {
    const name = validateCategoryName(input.name);
    if (!name.ok) return err(name.code);
    if (!(CATEGORY_COLOURS as readonly string[]).includes(input.colour)) return err('COLOUR_INVALID');
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(input.icon)) return err('ICON_INVALID');

    const all = await loadCategories(ctx);
    const current = input.id !== undefined ? all.find((c) => c.id === input.id) : undefined;
    if (input.id !== undefined) {
      if (!current) return err('CATEGORY_NOT_FOUND');
      if (current.id === UNCATEGORISED_ID) return err('CATEGORY_READONLY');
    }

    // A top-level category may change what it is used for; a subcategory always follows its parent.
    let kind: CategoryKind = current ? (current.parentId === null ? input.kind : current.kind) : input.kind;
    if (kind !== 'expense' && kind !== 'income' && kind !== 'mixed') return err('TYPE_INVALID');
    let parentId: string | null = current?.parentId ?? null;
    if (!current && input.parentId) {
      const parent = all.find((c) => c.id === input.parentId);
      // One level only, and only under a top-level, active spending category.
      if (!parent || parent.parentId !== null || parent.archived || parent.kind === 'income') return err('PARENT_INVALID');
      parentId = parent.id;
      kind = parent.kind;
    }
    if (kind === 'income' && input.budgetType !== null) return err('TYPE_INVALID');
    if (input.budgetType !== null && input.budgetType !== 'need' && input.budgetType !== 'want') return err('TYPE_INVALID');

    if (all.some((c) => !c.archived && kindsOverlap(c.kind, kind) && c.id !== current?.id && sameCategoryName(c.name, name.value))) return err('NAME_TAKEN');

    const at = ctx.nowMs();
    if (current) {
      if (kind !== current.kind) {
        // Leaving a side is allowed only when no entry of that side uses the category (or its subcategories).
        for (const side of SIDES[current.kind].filter((s) => !SIDES[kind].includes(s))) {
          const n = Number((await ctx.query(USE_BY_SIDE_SQL(side), [current.id, current.id]))[0]![0]);
          if (n > 0) return err(`KIND_IN_USE:${side}:${n}`);
        }
      }
      await ctx.execute('UPDATE category SET name = ?, kind = ?, icon = ?, color_token = ?, budget_type = ? WHERE id = ?', [name.value, kind, input.icon, input.colour, input.budgetType, current.id]);
      if (kind !== current.kind) {
        // Subcategories follow their parent in the same transaction; an income-only parent has no types.
        await ctx.execute(kind === 'income' ? 'UPDATE category SET kind = ?, budget_type = NULL WHERE parent_id = ?' : 'UPDATE category SET kind = ? WHERE parent_id = ?', [kind, current.id]);
      }
      ctx.touch('category', current.id, {
        before: { label: current.name, icon: current.icon, colour: current.colour, type: current.budgetType, usedFor: current.kind },
        after: { label: name.value, icon: input.icon, colour: input.colour, type: input.budgetType, usedFor: kind },
      });
      ctx.emit('CategoriesChanged', { categoryIds: [current.id] });
      return ok({ categoryId: current.id });
    }

    const order = Number((await ctx.query('SELECT COALESCE(MAX(sort_order), -1) + 1 FROM category'))[0]?.[0] ?? 0);
    const id = ctx.newId();
    await ctx.execute(
      'INSERT INTO category (id, parent_id, name, kind, budget_type, icon, color_token, sort_order, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
      [id, parentId, name.value, kind, input.budgetType, input.icon, input.colour, order],
    );
    ctx.touch('category', id, { added: true, after: { label: name.value, icon: input.icon, colour: input.colour, type: input.budgetType }, at });
    ctx.emit('CategoriesChanged', { categoryIds: [id] });
    return ok({ categoryId: id });
  },
};

export interface MoveResult {
  /** 1-based position among the siblings after the move, and how many there are. */
  readonly position: number;
  readonly of: number;
}

/**
 * Moves a category one place up or down among its siblings (the top-level categories of its kind, or the subcategories
 * of its parent). Subcategories travel with their parent because they are ordered inside it.
 */
export const MoveCategory: UseCase<{ categoryId: string; direction: 'up' | 'down'; segment?: 'expense' | 'income' }, MoveResult, 'CATEGORY_NOT_FOUND' | 'CATEGORY_READONLY' | 'AT_EDGE'> = {
  name: 'MoveCategory',
  async execute(ctx, input) {
    const rows = await ctx.query('SELECT id, kind, parent_id, sort_order FROM category WHERE archived = 0 ORDER BY sort_order, id');
    const list = rows.map((r) => ({ id: String(r[0]), kind: String(r[1]), parent: r[2] === null ? null : String(r[2]), order: Number(r[3]) }));
    const me = list.find((c) => c.id === input.categoryId);
    if (!me) return err('CATEGORY_NOT_FOUND');
    if (me.id === UNCATEGORISED_ID) return err('CATEGORY_READONLY');
    // A Both category shows in the Spending and the Income list, so it moves within the list the user is looking at.
    const segment = input.segment ?? (me.kind === 'income' ? 'income' : 'expense');
    const siblings = list.filter((c) => c.parent === me.parent && (me.parent !== null ? c.kind === me.kind : c.kind === segment || c.kind === 'mixed'));
    const i = siblings.findIndex((c) => c.id === me.id);
    if (i < 0) return err('CATEGORY_NOT_FOUND');
    const j = i + (input.direction === 'up' ? -1 : 1);
    if (j < 0 || j >= siblings.length) return err('AT_EDGE');
    // Reuse the same set of order numbers in the new sequence, so no other category's place changes.
    const slots = siblings.map((c) => c.order);
    const ids = siblings.map((c) => c.id);
    [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
    for (const [k, id] of ids.entries()) await ctx.execute('UPDATE category SET sort_order = ? WHERE id = ?', [slots[k] as number, id]);
    ctx.touch('category', me.id, { moved: input.direction });
    ctx.emit('CategoriesChanged', { categoryIds: ids });
    return ok({ position: j + 1, of: siblings.length });
  },
};

/**
 * Spending by Need / Want / Not classified over a local-date range (inclusive). Params: start, end. The type is read
 * from the category at query time, so changing a category's type moves its spending for every period, past and current,
 * and no amount, split or posting changes.
 */
export const SPENDING_BY_BUDGET_TYPE_SQL =
  "SELECT c.budget_type, COALESCE(SUM(s.amount_minor), 0) FROM split s JOIN \"transaction\" t ON t.id = s.transaction_id JOIN category c ON c.id = s.category_id WHERE t.event_type = 'expense' AND t.status = 'confirmed' AND t.removed_at IS NULL AND t.local_date BETWEEN ? AND ? GROUP BY c.budget_type";

export interface SpendingByBudgetType {
  readonly needMinor: number;
  readonly wantMinor: number;
  readonly notClassifiedMinor: number;
}

export function spendingByBudgetType(rows: readonly (readonly unknown[])[]): SpendingByBudgetType {
  let need = 0;
  let want = 0;
  let none = 0;
  for (const r of rows) {
    const n = Number(r[1]);
    if (r[0] === 'need') need += n;
    else if (r[0] === 'want') want += n;
    else none += n;
  }
  return { needMinor: need, wantMinor: want, notClassifiedMinor: none };
}

/** The caption under a spending category: `Need`, `Want` or `Not classified`. */
export const budgetTypeCaption = (t: BudgetType | null): 'Need' | 'Want' | 'Not classified' => (t === 'need' ? 'Need' : t === 'want' ? 'Want' : 'Not classified');
