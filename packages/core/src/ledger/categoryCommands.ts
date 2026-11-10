import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { UNCATEGORISED_ID, type BudgetType, type CategoryKind } from './categories';

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
  /** Used when adding a top-level category; a subcategory takes its parent's kind and an edit keeps the kind. */
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
  | 'CATEGORY_READONLY';

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

    let kind: CategoryKind = current?.kind ?? input.kind;
    let parentId: string | null = current?.parentId ?? null;
    if (!current && input.parentId) {
      const parent = all.find((c) => c.id === input.parentId);
      // One level only, and only under a top-level, active spending category.
      if (!parent || parent.parentId !== null || parent.archived || parent.kind !== 'expense') return err('PARENT_INVALID');
      parentId = parent.id;
      kind = parent.kind;
    }
    if (kind === 'income' && input.budgetType !== null) return err('TYPE_INVALID');
    if (input.budgetType !== null && input.budgetType !== 'need' && input.budgetType !== 'want') return err('TYPE_INVALID');

    if (all.some((c) => !c.archived && c.kind === kind && c.id !== current?.id && sameCategoryName(c.name, name.value))) return err('NAME_TAKEN');

    const at = ctx.nowMs();
    if (current) {
      await ctx.execute('UPDATE category SET name = ?, icon = ?, color_token = ?, budget_type = ? WHERE id = ?', [name.value, input.icon, input.colour, input.budgetType, current.id]);
      ctx.touch('category', current.id, {
        before: { label: current.name, icon: current.icon, colour: current.colour, type: current.budgetType },
        after: { label: name.value, icon: input.icon, colour: input.colour, type: input.budgetType },
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
export const MoveCategory: UseCase<{ categoryId: string; direction: 'up' | 'down' }, MoveResult, 'CATEGORY_NOT_FOUND' | 'CATEGORY_READONLY' | 'AT_EDGE'> = {
  name: 'MoveCategory',
  async execute(ctx, input) {
    const rows = await ctx.query('SELECT id, kind, parent_id, sort_order FROM category WHERE archived = 0 ORDER BY sort_order, id');
    const list = rows.map((r) => ({ id: String(r[0]), kind: String(r[1]), parent: r[2] === null ? null : String(r[2]), order: Number(r[3]) }));
    const me = list.find((c) => c.id === input.categoryId);
    if (!me) return err('CATEGORY_NOT_FOUND');
    if (me.id === UNCATEGORISED_ID) return err('CATEGORY_READONLY');
    const siblings = list.filter((c) => c.kind === me.kind && c.parent === me.parent);
    const i = siblings.findIndex((c) => c.id === me.id);
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
