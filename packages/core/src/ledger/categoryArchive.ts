import { err, ok } from '../shared/result';
import type { UseCase, WriterContext } from '../writer/ledgerWriter';
import { categoryFits, UNCATEGORISED_ID, type BudgetType, type CategoryKind } from './categories';
import { sameCategoryName } from './categoryCommands';
import { budgetsEndingWith, endBudgets, reopenBudgets } from '../planning/budgetStore';

/** `Uncategorised` and `Other` are system fallbacks: no archive, merge or delete (CAT-004). */
export const OTHER_ID = 'cat_other';
export const isSystemCategory = (id: string): boolean => id === UNCATEGORISED_ID || id === OTHER_ID;

export type CategoryActionError =
  | 'CATEGORY_NOT_FOUND'
  | 'CATEGORY_READONLY'
  | 'ALREADY_ARCHIVED'
  | 'NOT_ARCHIVED'
  | 'NAME_TAKEN'
  | 'IN_USE'
  | 'HAS_SUBCATEGORIES'
  | 'TARGET_INVALID'
  | 'CATEGORY_KIND_MISMATCH'
  | 'AMOUNTS_CHANGED';

interface Cat {
  readonly id: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly budgetType: BudgetType | null;
  readonly parentId: string | null;
  readonly archived: boolean;
  readonly sortOrder: number;
  readonly icon: string;
  readonly colour: string;
}

async function loadAll(ctx: Pick<WriterContext, 'query'>): Promise<Cat[]> {
  const rows = await ctx.query('SELECT id, name, kind, budget_type, parent_id, archived, sort_order, icon, color_token FROM category ORDER BY sort_order, id');
  return rows.map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    kind: String(r[2]) as CategoryKind,
    budgetType: r[3] === null ? null : (String(r[3]) as BudgetType),
    parentId: r[4] === null ? null : String(r[4]),
    archived: Number(r[5]) === 1,
    sortOrder: Number(r[6]),
    icon: String(r[7]),
    colour: String(r[8]),
  }));
}

/** The category and its subcategories (one level only). */
const familyOf = (all: readonly Cat[], id: string): Cat[] => all.filter((c) => c.id === id || c.parentId === id);

/** Audit fields are redacted, and a dash-separated id can contain a digits-only part that would be masked; without dashes it reads whole. */
const compactId = (id: string): string => id.replace(/-/g, '');

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Entry types fit a category by what they are: income is income, everything else (expense, refund, fee) is spending. */
const fitType = (eventType: string): 'income' | 'expense' => (eventType === 'income' ? 'income' : 'expense');

export interface RemapPreview {
  readonly name: string;
  /** Live (not deleted) entries that use the category or its subcategories. */
  readonly entries: number;
  readonly subcategories: number;
  /** All splits, deleted entries included: the category can only be deleted when this is zero. */
  readonly splits: number;
  readonly isSystem: boolean;
  readonly archived: boolean;
  /** Names of the budgets whose only category this is: they end after the current period (Story 4.6). */
  readonly endingBudgets: readonly string[];
}

/** The numbers behind the archive preview and the delete confirmation. Reads only. */
export async function previewCategory(ctx: Pick<WriterContext, 'query'>, categoryId: string): Promise<RemapPreview | null> {
  const all = await loadAll(ctx);
  const me = all.find((c) => c.id === categoryId);
  if (!me) return null;
  const family = familyOf(all, categoryId);
  const ids = family.map((c) => c.id);
  const live = Number((await ctx.query(`SELECT COUNT(DISTINCT t.id) FROM split s JOIN "transaction" t ON t.id = s.transaction_id WHERE s.category_id IN (${marks(ids.length)}) AND t.removed_at IS NULL`, ids))[0]![0]);
  const splits = Number((await ctx.query(`SELECT COUNT(*) FROM split WHERE category_id IN (${marks(ids.length)})`, ids))[0]![0]);
  // A receipt line holds its category too, so a category only a line names is in use.
  const receiptLines = Number((await ctx.query(`SELECT COUNT(*) FROM receipt_item WHERE category_id IN (${marks(ids.length)})`, ids))[0]![0]);
  const ending = await budgetsEndingWith(ctx, ids);
  return { name: me.name, entries: live, subcategories: family.length - 1, splits: splits + receiptLines, isSystem: isSystemCategory(me.id), archived: me.archived, endingBudgets: ending.map((b) => b.name) };
}

export interface RemapEntry {
  readonly id: string;
  readonly localDate: string;
  readonly merchant: string | null;
  readonly amountMinor: number;
  readonly type: string;
}

/** One page of the entries that use a category and its subcategories, newest first. Params: ids..., limit, offset. */
export const categoryEntriesSql = (idCount: number): string =>
  `SELECT t.id, t.local_date, t.original_description, t.amount_minor, t.event_type FROM "transaction" t WHERE t.removed_at IS NULL AND EXISTS (SELECT 1 FROM split s WHERE s.transaction_id = t.id AND s.category_id IN (${marks(idCount)})) ORDER BY t.local_date DESC, t.id DESC LIMIT ? OFFSET ?`;

export const mapRemapEntries = (rows: readonly (readonly unknown[])[]): RemapEntry[] =>
  rows.map((r) => ({ id: String(r[0]), localDate: String(r[1]), merchant: r[2] === null ? null : String(r[2]), amountMinor: Number(r[3]), type: String(r[4]) }));

/** The category and subcategory ids an archive or merge covers. */
export async function familyIds(ctx: Pick<WriterContext, 'query'>, categoryId: string): Promise<string[]> {
  return familyOf(await loadAll(ctx), categoryId).map((c) => c.id);
}

/** Why a category cannot be the target of a merge from `fromId`, or null when it can. */
export function mergeTargetProblem(fromId: string, target: Cat | undefined): 'TARGET_INVALID' | null {
  if (!target || target.archived || target.id === UNCATEGORISED_ID) return 'TARGET_INVALID';
  if (target.id === fromId || target.parentId === fromId) return 'TARGET_INVALID';
  return null;
}

/** Archives a category and its subcategories in one step; the entries stay where they are. */
export const ArchiveCategory: UseCase<{ categoryId: string }, { archivedIds: string[] }, CategoryActionError> = {
  name: 'ArchiveCategory',
  async execute(ctx, input) {
    const all = await loadAll(ctx);
    const me = all.find((c) => c.id === input.categoryId);
    if (!me) return err('CATEGORY_NOT_FOUND');
    if (isSystemCategory(me.id)) return err('CATEGORY_READONLY');
    if (me.archived) return err('ALREADY_ARCHIVED');
    const ids = familyOf(all, me.id).filter((c) => !c.archived).map((c) => c.id);
    await ctx.execute(`UPDATE category SET archived = 1 WHERE id IN (${marks(ids.length)})`, ids);
    ctx.touch('category', me.id, { archived: true, label: me.name, subcategories: ids.length - 1 });
    ctx.emit('CategoriesChanged', { categoryIds: ids });
    const ended = await endBudgets(ctx, ids);
    if (ended.length > 0) ctx.emit('BudgetsChanged', { budgetIds: ended });
    return ok({ archivedIds: ids });
  },
};

/** Brings an archived category (and the subcategories archived with it) back to the pickers, in its old position. */
export const RestoreCategory: UseCase<{ categoryId: string; ids?: readonly string[] }, { restoredIds: string[] }, CategoryActionError> = {
  name: 'RestoreCategory',
  async execute(ctx, input) {
    const all = await loadAll(ctx);
    const me = all.find((c) => c.id === input.categoryId);
    if (!me) return err('CATEGORY_NOT_FOUND');
    if (!me.archived) return err('NOT_ARCHIVED');
    // A subcategory restored alone needs an active parent.
    const parent = me.parentId ? all.find((c) => c.id === me.parentId) : undefined;
    if (parent?.archived) return err('TARGET_INVALID');
    const wanted = input.ids ? new Set(input.ids) : null;
    const restoring = familyOf(all, me.id).filter((c) => c.archived && (wanted ? wanted.has(c.id) : true));
    if (!restoring.some((c) => c.id === me.id)) restoring.push(me);
    // A name that another active category took meanwhile blocks the restore, so the lists never hold two of a kind.
    const active = all.filter((c) => !c.archived);
    for (const c of restoring) {
      const kinds = (k: string) => k === 'mixed' || c.kind === 'mixed' || k === c.kind;
      if (active.some((a) => kinds(a.kind) && sameCategoryName(a.name, c.name))) return err('NAME_TAKEN');
    }
    const ids = restoring.map((c) => c.id);
    await ctx.execute(`UPDATE category SET archived = 0 WHERE id IN (${marks(ids.length)})`, ids);
    ctx.touch('category', me.id, { restored: true, label: me.name });
    ctx.emit('CategoriesChanged', { categoryIds: ids });
    const reopened = await reopenBudgets(ctx, ids);
    if (reopened.length > 0) ctx.emit('BudgetsChanged', { budgetIds: reopened });
    return ok({ restoredIds: ids });
  },
};

export interface DeletedCategory {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly budgetType: BudgetType | null;
  readonly icon: string;
  readonly colour: string;
  readonly sortOrder: number;
  readonly archived: boolean;
}

/** Deletes a category nothing uses: no split (deleted entries included) and no subcategory. The result lets Undo put it back. */
export const DeleteCategory: UseCase<{ categoryId: string }, { deleted: DeletedCategory }, CategoryActionError> = {
  name: 'DeleteCategory',
  async execute(ctx, input) {
    const all = await loadAll(ctx);
    const me = all.find((c) => c.id === input.categoryId);
    if (!me) return err('CATEGORY_NOT_FOUND');
    if (isSystemCategory(me.id)) return err('CATEGORY_READONLY');
    if (all.some((c) => c.parentId === me.id)) return err('HAS_SUBCATEGORIES');
    if (Number((await ctx.query('SELECT COUNT(*) FROM split WHERE category_id = ?', [me.id]))[0]![0]) > 0) return err('IN_USE');
    // A receipt line keeps the category it was given, so it holds the category too.
    if (Number((await ctx.query('SELECT COUNT(*) FROM receipt_item WHERE category_id = ?', [me.id]))[0]![0]) > 0) return err('IN_USE');
    await ctx.execute('DELETE FROM category WHERE id = ?', [me.id]);
    ctx.touch('category', me.id, { deleted: true, label: me.name });
    ctx.emit('CategoriesChanged', { categoryIds: [me.id] });
    return ok({ deleted: { id: me.id, parentId: me.parentId, name: me.name, kind: me.kind, budgetType: me.budgetType, icon: me.icon, colour: me.colour, sortOrder: me.sortOrder, archived: me.archived } });
  },
};

/** Undo of a delete: the category comes back exactly as it was, in the same place. */
export const UndoDeleteCategory: UseCase<{ deleted: DeletedCategory }, { categoryId: string }, CategoryActionError> = {
  name: 'UndoDeleteCategory',
  async execute(ctx, input) {
    const d = input.deleted;
    const all = await loadAll(ctx);
    if (all.some((c) => c.id === d.id)) return err('CATEGORY_NOT_FOUND');
    if (d.parentId && !all.some((c) => c.id === d.parentId)) return err('TARGET_INVALID');
    if (all.some((c) => !c.archived && (c.kind === 'mixed' || d.kind === 'mixed' || c.kind === d.kind) && sameCategoryName(c.name, d.name))) return err('NAME_TAKEN');
    await ctx.execute('INSERT INTO category (id, parent_id, name, kind, budget_type, icon, color_token, sort_order, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      d.id, d.parentId, d.name, d.kind, d.budgetType, d.icon, d.colour, d.sortOrder, d.archived ? 1 : 0,
    ]);
    ctx.touch('category', d.id, { restored: true, label: d.name });
    ctx.emit('CategoriesChanged', { categoryIds: [d.id] });
    return ok({ categoryId: d.id });
  },
};

export interface MergeResult {
  readonly movedSplits: number;
  readonly movedEntries: number;
  /** Where each moved split was, so Undo can put every one back. */
  readonly previous: readonly { splitId: string; categoryId: string }[];
  /** The same for the saved receipt lines that moved. */
  readonly previousItems: readonly { itemId: string; categoryId: string }[];
  readonly archivedIds: readonly string[];
  readonly targetId: string;
}

/** Amount and postings of the touched entries, to prove nothing but the category changed. */
async function fingerprint(ctx: WriterContext, txIds: readonly string[]): Promise<string> {
  const parts: string[] = [];
  for (let i = 0; i < txIds.length; i += 200) {
    const chunk = txIds.slice(i, i + 200);
    const rows = await ctx.query(
      `SELECT t.id, t.amount_minor, t.local_date, t.status, (SELECT group_concat(s.id || ':' || s.amount_minor, '|') FROM (SELECT * FROM split WHERE transaction_id = t.id ORDER BY id) s), (SELECT group_concat(p.id || ':' || p.account_id || ':' || p.signed_amount_minor, '|') FROM (SELECT * FROM posting WHERE transaction_id = t.id ORDER BY id) p) FROM "transaction" t WHERE t.id IN (${marks(chunk.length)}) ORDER BY t.id`,
      chunk,
    );
    for (const r of rows) parts.push(r.map(String).join('~'));
  }
  return parts.join('\n');
}

/**
 * Merges a category (and its subcategories) into another: every split moves to the target, including splits of split
 * entries, refunds and entries still to check, and deleted ones too, so a restore never lands on an archived category. An
 * audit row per entry keeps the original category. Nothing but `category_id` changes; the writer checks every amount,
 * split amount and posting before it commits. The merged categories are archived.
 */
export const MergeCategory: UseCase<{ fromId: string; intoId: string }, MergeResult, CategoryActionError> = {
  name: 'MergeCategory',
  async execute(ctx, input) {
    const all = await loadAll(ctx);
    const from = all.find((c) => c.id === input.fromId);
    if (!from) return err('CATEGORY_NOT_FOUND');
    if (isSystemCategory(from.id)) return err('CATEGORY_READONLY');
    if (from.archived) return err('ALREADY_ARCHIVED');
    const target = all.find((c) => c.id === input.intoId);
    if (mergeTargetProblem(from.id, target)) return err('TARGET_INVALID');
    const family = familyOf(all, from.id);
    const ids = family.map((c) => c.id);
    const names = new Map(family.map((c) => [c.id, c.name]));

    const splits = (await ctx.query(`SELECT s.id, s.category_id, s.transaction_id, t.event_type FROM split s JOIN "transaction" t ON t.id = s.transaction_id WHERE s.category_id IN (${marks(ids.length)}) ORDER BY s.id`, ids)).map((r) => ({
      id: String(r[0]), categoryId: String(r[1]), transactionId: String(r[2]), type: String(r[3]),
    }));
    // Every kind of entry that would move has to fit the target (an income entry cannot land in a spending category).
    for (const s of splits) if (!categoryFits(target!.kind, fitType(s.type))) return err('CATEGORY_KIND_MISMATCH');

    const txIds = [...new Set(splits.map((s) => s.transactionId))];
    const before = await fingerprint(ctx, txIds);
    const now = ctx.nowMs();
    for (const s of splits) await ctx.execute('UPDATE split SET category_id = ? WHERE id = ?', [target!.id, s.id]);
    const items = (await ctx.query(`SELECT id, category_id FROM receipt_item WHERE category_id IN (${marks(ids.length)}) ORDER BY id`, ids)).map((r) => ({ itemId: String(r[0]), categoryId: String(r[1]) }));
    await ctx.execute(`UPDATE receipt_item SET category_id = ? WHERE category_id IN (${marks(ids.length)})`, [target!.id, ...ids]);
    for (const tx of txIds) {
      await ctx.execute('UPDATE "transaction" SET updated_at = ? WHERE id = ?', [now, tx]);
      const first = splits.find((s) => s.transactionId === tx)!;
      ctx.touch('transaction', tx, { edited: true, fields: 'category', merged: true, fromCategoryId: compactId(first.categoryId), fromLabel: names.get(first.categoryId) ?? '' });
    }
    if ((await fingerprint(ctx, txIds)) !== before) return err('AMOUNTS_CHANGED');

    const archived = family.filter((c) => !c.archived).map((c) => c.id);
    await ctx.execute(`UPDATE category SET archived = 1 WHERE id IN (${marks(archived.length)})`, archived);
    ctx.touch('category', from.id, { merged: true, label: from.name, intoId: target!.id, intoLabel: target!.name, entries: txIds.length });
    if (txIds.length > 0) {
      ctx.emit('TransactionsChanged', { transactionIds: txIds });
      ctx.emit('CategoryAssigned', { transactionIds: txIds });
    }
    ctx.emit('CategoriesChanged', { categoryIds: [...archived, target!.id] });
    const ended = await endBudgets(ctx, archived);
    if (ended.length > 0) ctx.emit('BudgetsChanged', { budgetIds: ended });
    return ok({ movedSplits: splits.length, movedEntries: txIds.length, previous: splits.map((s) => ({ splitId: s.id, categoryId: s.categoryId })), previousItems: items, archivedIds: archived, targetId: target!.id });
  },
};

/** Undo of a merge: every split goes back where it was and the merged categories return, in one step. */
export const UndoMergeCategory: UseCase<{ previous: readonly { splitId: string; categoryId: string }[]; previousItems?: readonly { itemId: string; categoryId: string }[]; archivedIds: readonly string[]; targetId: string }, { restored: number }, CategoryActionError> = {
  name: 'UndoMergeCategory',
  async execute(ctx, input) {
    const all = await loadAll(ctx);
    const active = all.filter((c) => !c.archived && !input.archivedIds.includes(c.id));
    for (const id of input.archivedIds) {
      const c = all.find((x) => x.id === id);
      if (!c) return err('CATEGORY_NOT_FOUND');
      if (active.some((a) => (a.kind === 'mixed' || c.kind === 'mixed' || a.kind === c.kind) && sameCategoryName(a.name, c.name))) return err('NAME_TAKEN');
    }
    if (input.archivedIds.length > 0) await ctx.execute(`UPDATE category SET archived = 0 WHERE id IN (${marks(input.archivedIds.length)})`, [...input.archivedIds]);
    const now = ctx.nowMs();
    const txIds = new Set<string>();
    let restored = 0;
    for (const p of input.previous) {
      // Only a split still in the target goes back; one the user moved since is left as they made it.
      const row = (await ctx.query('SELECT transaction_id FROM split WHERE id = ? AND category_id = ?', [p.splitId, input.targetId]))[0];
      if (!row) continue;
      await ctx.execute('UPDATE split SET category_id = ? WHERE id = ?', [p.categoryId, p.splitId]);
      txIds.add(String(row[0]));
      restored += 1;
    }
    for (const p of input.previousItems ?? []) await ctx.execute('UPDATE receipt_item SET category_id = ? WHERE id = ? AND category_id = ?', [p.categoryId, p.itemId, input.targetId]);
    for (const tx of txIds) {
      await ctx.execute('UPDATE "transaction" SET updated_at = ? WHERE id = ?', [now, tx]);
      ctx.touch('transaction', tx, { edited: true, fields: 'category', mergeUndo: true });
    }
    if (txIds.size > 0) {
      ctx.emit('TransactionsChanged', { transactionIds: [...txIds] });
      ctx.emit('CategoryAssigned', { transactionIds: [...txIds] });
    }
    ctx.emit('CategoriesChanged', { categoryIds: [...input.archivedIds, input.targetId] });
    const reopened = await reopenBudgets(ctx, input.archivedIds);
    if (reopened.length > 0) ctx.emit('BudgetsChanged', { budgetIds: reopened });
    return ok({ restored });
  },
};

/** The sentence about a changed type: `Fuel is a Need and Transport is a Want, so these entries count as Wants...`. Null when the types match or the target is income. */
export function typeChangeNote(from: { name: string; budgetType: BudgetType | null; kind: CategoryKind }, to: { name: string; budgetType: BudgetType | null; kind: CategoryKind }): { fromType: string; toType: string } | null {
  if (from.kind === 'income' || to.kind === 'income') return null;
  if (from.budgetType === to.budgetType) return null;
  const word = (t: BudgetType | null) => (t === 'need' ? 'Need' : t === 'want' ? 'Want' : 'Not classified');
  return { fromType: word(from.budgetType), toType: word(to.budgetType) };
}

/** The merge history of one entry, from the audit trail. Param: transaction id. */
export const ORIGINAL_CATEGORIES_SQL =
  "SELECT kind, change_json FROM audit_event WHERE entity_kind = 'transaction' AND entity_id = ? AND kind IN ('MergeCategory', 'UndoMergeCategory') ORDER BY created_at, id";

/** Names of the categories an entry was merged away from, oldest first; an undone merge no longer counts. */
export function mapOriginalCategories(rows: readonly (readonly unknown[])[]): string[] {
  const names: string[] = [];
  for (const r of rows) {
    if (String(r[0]) === 'UndoMergeCategory') {
      names.pop();
      continue;
    }
    try {
      const label = (JSON.parse(String(r[1])) as { fromLabel?: unknown }).fromLabel;
      if (typeof label === 'string' && label !== '') names.push(label);
    } catch {
      // An unreadable audit row is skipped; the entry itself is unaffected.
    }
  }
  return names;
}
