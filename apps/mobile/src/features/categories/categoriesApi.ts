import {
  ARCHIVED_CATEGORY_LIST_SQL,
  ArchiveCategory,
  CATEGORY_LIST_SQL,
  categoryEntriesSql,
  DeleteCategory,
  familyIds,
  mapCategoryRows,
  mapRemapEntries,
  MergeCategory,
  MoveCategory,
  previewCategory,
  RestoreCategory,
  SaveCategory,
  UndoDeleteCategory,
  UndoMergeCategory,
  type CategoryRow,
  type CurrencyCode,
  type DeletedCategory,
  type MergeResult,
  type MoveResult,
  type RemapEntry,
  type RemapPreview,
  type SaveCategoryError,
  type SaveCategoryInput,
} from '@wmbugo/core';
import { getServices } from '../../adapters/startApp';
import { readProfile } from '../../adapters/readProfile';

export interface CategoriesData {
  /** Every active category, in sort order, both kinds and subcategories included. */
  readonly rows: CategoryRow[];
  /** Archived categories, for the collapsed Archived section. */
  readonly archived: CategoryRow[];
}

export interface EntriesPage {
  readonly rows: RemapEntry[];
  readonly currency: CurrencyCode;
  readonly locale: string;
}

export type SaveOutcome = { ok: true; categoryId: string } | { ok: false; code: SaveCategoryError | string };
export type MoveOutcome = { ok: true; value: MoveResult } | { ok: false; code: string };
export type ActionOutcome<T> = { ok: true; value: T } | { ok: false; code: string };

/** What the categories screen needs. The real one goes through the ledger writer; tests pass a fake. */
export interface CategoriesApi {
  load(): Promise<CategoriesData>;
  save(input: SaveCategoryInput): Promise<SaveOutcome>;
  move(categoryId: string, direction: 'up' | 'down', segment: 'expense' | 'income'): Promise<MoveOutcome>;
  /** How many entries use a category (and its subcategories); read-only, for the archive and delete sheets. */
  preview(categoryId: string): Promise<RemapPreview | null>;
  /** One page of those entries, newest first. */
  entries(categoryId: string, limit: number, offset: number): Promise<EntriesPage>;
  archive(categoryId: string): Promise<ActionOutcome<{ archivedIds: string[] }>>;
  restore(categoryId: string): Promise<ActionOutcome<{ restoredIds: string[] }>>;
  merge(fromId: string, intoId: string): Promise<ActionOutcome<MergeResult>>;
  undoMerge(result: MergeResult): Promise<ActionOutcome<{ restored: number }>>;
  remove(categoryId: string): Promise<ActionOutcome<{ deleted: DeletedCategory }>>;
  undoRemove(deleted: DeletedCategory): Promise<ActionOutcome<{ categoryId: string }>>;
}

export const CATEGORIES_QUERY_KEY = ['ledger', 'categories'] as const;

const run = async <T>(p: Promise<{ ok: true; value: T } | { ok: false; code: string }>): Promise<ActionOutcome<T>> => {
  const r = await p;
  return r.ok ? { ok: true, value: r.value } : { ok: false, code: r.code };
};

export const realCategoriesApi: CategoriesApi = {
  async load() {
    const db = getServices().db;
    return { rows: mapCategoryRows(await db.query(CATEGORY_LIST_SQL)), archived: mapCategoryRows(await db.query(ARCHIVED_CATEGORY_LIST_SQL)) };
  },
  async save(input) {
    const r = await getServices().writer.run(SaveCategory, input, 'user');
    return r.ok ? { ok: true, categoryId: r.value.categoryId } : { ok: false, code: r.code };
  },
  async move(categoryId, direction, segment) {
    const r = await getServices().writer.run(MoveCategory, { categoryId, direction, segment }, 'user');
    return r.ok ? { ok: true, value: r.value } : { ok: false, code: r.code };
  },
  preview: (categoryId) => previewCategory(getServices().db, categoryId),
  async entries(categoryId, limit, offset) {
    const db = getServices().db;
    const ids = await familyIds(db, categoryId);
    const p = await readProfile(db);
    const rows = mapRemapEntries(await db.query(categoryEntriesSql(ids.length), [...ids, limit, offset]));
    return { rows, currency: p?.currency ?? 'INR', locale: p?.locale ?? 'en-IN' };
  },
  archive: (categoryId) => run(getServices().writer.run(ArchiveCategory, { categoryId }, 'user')),
  restore: (categoryId) => run(getServices().writer.run(RestoreCategory, { categoryId }, 'user')),
  merge: (fromId, intoId) => run(getServices().writer.run(MergeCategory, { fromId, intoId }, 'user')),
  undoMerge: (r) => run(getServices().writer.run(UndoMergeCategory, { previous: r.previous, archivedIds: r.archivedIds, targetId: r.targetId }, 'user')),
  remove: (categoryId) => run(getServices().writer.run(DeleteCategory, { categoryId }, 'user')),
  undoRemove: (deleted) => run(getServices().writer.run(UndoDeleteCategory, { deleted }, 'user')),
};
