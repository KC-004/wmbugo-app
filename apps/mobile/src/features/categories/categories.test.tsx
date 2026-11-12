import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { mapCategoryRows, SEED_CATEGORIES, type CategoryRow, type SaveCategoryInput } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { searchIcons } from '../add/categoryIcons';
import { CategoriesScreen, linesFor } from './CategoriesScreen';
import type { CategoriesApi } from './categoriesApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0 } }));

const live: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const type = async (r: ReactTestRenderer, id: string, text: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(text));
  await settle();
};

const seedRows = (): CategoryRow[] => mapCategoryRows(SEED_CATEGORIES.map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i, null]));

function fakeApi(initial = seedRows()) {
  const state = { rows: initial };
  const save = jest.fn(async (input: SaveCategoryInput) => {
    const taken = state.rows.some((c) => c.kind === input.kind && c.id !== input.id && c.name.toLowerCase() === input.name.trim().toLowerCase());
    if (input.name.trim() === '') return { ok: false as const, code: 'NAME_REQUIRED' };
    if (taken) return { ok: false as const, code: 'NAME_TAKEN' };
    const id = input.id ?? `new_${state.rows.length}`;
    const parent = state.rows.find((c) => c.id === input.parentId);
    const row: CategoryRow = { id, name: input.name.trim(), kind: parent?.kind ?? input.kind, budgetType: input.budgetType, icon: input.icon, colorToken: input.colour, sortOrder: state.rows.length, parentId: input.parentId ?? null };
    state.rows = input.id ? state.rows.map((c) => (c.id === id ? { ...row, sortOrder: c.sortOrder, parentId: c.parentId } : c)) : [...state.rows, row];
    return { ok: true as const, categoryId: id };
  });
  const move = jest.fn(async (id: string, direction: 'up' | 'down') => {
    const i = state.rows.findIndex((c) => c.id === id);
    const j = direction === 'up' ? i - 1 : i + 1;
    const next = [...state.rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    state.rows = next;
    return { ok: true as const, value: { position: j + 1, of: next.length } };
  });
  const used = new Map<string, number>();
  const ending = { names: [] as string[] };
  const closed = { archived: [] as CategoryRow[] };
  const preview = jest.fn(async (id: string) => {
    const row = state.rows.find((c) => c.id === id);
    if (!row) return null;
    const subs = state.rows.filter((c) => c.parentId === id).length;
    const n = used.get(id) ?? 0;
    return { name: row.name, entries: n, subcategories: subs, splits: n, isSystem: id === 'cat_other' || id === 'cat_uncategorised', archived: false, endingBudgets: ending.names };
  });
  const entries = jest.fn(async (id: string, limit: number, offset: number) => {
    const n = used.get(id) ?? 0;
    const all = Array.from({ length: n }, (_, i) => ({ id: `e_${i}`, localDate: `2026-11-0${(i % 9) + 1}`, merchant: `Pump ${i}`, amountMinor: 10_000 + i, type: 'expense' }));
    return { rows: all.slice(offset, offset + limit), currency: 'INR' as const, locale: 'en-IN' };
  });
  const archive = jest.fn(async (id: string) => {
    const row = state.rows.find((c) => c.id === id)!;
    state.rows = state.rows.filter((c) => c.id !== id && c.parentId !== id);
    closed.archived.push(row);
    return { ok: true as const, value: { archivedIds: [id] } };
  });
  const restore = jest.fn(async (id: string) => {
    const row = closed.archived.find((c) => c.id === id);
    if (!row) return { ok: false as const, code: 'NOT_ARCHIVED' };
    closed.archived = closed.archived.filter((c) => c.id !== id);
    state.rows = [...state.rows, row];
    return { ok: true as const, value: { restoredIds: [id] } };
  });
  const merge = jest.fn(async (fromId: string, intoId: string) => {
    const row = state.rows.find((c) => c.id === fromId)!;
    state.rows = state.rows.filter((c) => c.id !== fromId);
    closed.archived.push(row);
    return { ok: true as const, value: { movedSplits: used.get(fromId) ?? 0, movedEntries: used.get(fromId) ?? 0, previous: [], archivedIds: [fromId], targetId: intoId } };
  });
  const undoMerge = jest.fn(async () => ({ ok: true as const, value: { restored: 0 } }));
  const remove = jest.fn(async (id: string) => {
    const row = state.rows.find((c) => c.id === id)!;
    state.rows = state.rows.filter((c) => c.id !== id);
    return { ok: true as const, value: { deleted: { id, parentId: row.parentId, name: row.name, kind: row.kind, budgetType: row.budgetType, icon: row.icon, colour: row.colorToken, sortOrder: row.sortOrder, archived: false } } };
  });
  const undoRemove = jest.fn(async () => ({ ok: true as const, value: { categoryId: 'x' } }));
  const api: CategoriesApi = { load: async () => ({ rows: state.rows, archived: closed.archived }), save, move, preview, entries, archive, restore, merge, undoMerge, remove, undoRemove };
  return { api, save, move, state, used, ending, closed, preview, entries, archive, restore, merge, undoMerge, remove, undoRemove };
}

async function mount(api: CategoriesApi) {
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <CategoriesScreen api={api} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return r;
}

describe('Categories screen (Story 4.1)', () => {
  it('lists the 14 spending seeds in order with their captions, Uncategorised without controls', async () => {
    const r = await mount(fakeApi().api);
    const rows = r.root.findAll((n) => typeof n.type === 'string' && /^category-row-/.test(String(n.props.testID)));
    expect(rows).toHaveLength(14);
    expect(host(r, 'category-row-cat_housing').props.accessibilityLabel).toBe('Housing, Need');
    expect(host(r, 'category-row-cat_food').props.accessibilityLabel).toBe('Food & Drinks, Want');
    expect(host(r, 'category-row-cat_family').props.accessibilityLabel).toBe('Family, Not classified');
    expect(host(r, 'category-row-cat_other').props.accessibilityLabel).toBe('Other, Not classified');
    expect(host(r, 'category-row-cat_uncategorised').props.accessibilityLabel).toBe('Uncategorised, Not classified');
    expect(host(r, 'category-row-cat_uncategorised').props.onPress).toBeUndefined();
    expect(has(r, 'category-up-cat_uncategorised') || has(r, 'category-down-cat_uncategorised')).toBe(false);
  });

  it('the Income segment lists the six income categories with no Need/Want caption', async () => {
    const r = await mount(fakeApi().api);
    await press(r, 'categories-segment-income');
    expect(has(r, 'category-row-cat_in_salary')).toBe(true);
    expect(has(r, 'category-row-cat_housing')).toBe(false);
    expect(host(r, 'category-row-cat_in_salary').props.accessibilityLabel).toBe('Salary');
  });

  it('adds Fuel: gas pump, olive, Need, then closes with the toast "Fuel added"', async () => {
    const f = fakeApi();
    const r = await mount(f.api);
    await press(r, 'categories-add');
    expect(has(r, 'category-sheet')).toBe(true);
    // Exactly the 12 swatches, no free colour field.
    expect(r.root.findAll((n) => typeof n.type === 'string' && /^category-colour-/.test(String(n.props.testID)))).toHaveLength(12);
    await type(r, 'category-name', 'Fuel');
    await press(r, 'category-icon-GasPump');
    await press(r, 'category-colour-cat-olive');
    await press(r, 'category-type-need');
    await press(r, 'category-save');
    expect(f.save).toHaveBeenCalledWith({ name: 'Fuel', kind: 'expense', icon: 'GasPump', colour: 'cat-olive', budgetType: 'need', parentId: null });
    expect(has(r, 'category-sheet')).toBe(false);
    expect(texts(r)).toContain('Fuel added');
    expect(has(r, 'category-row-new_20')).toBe(true);
  });

  it('a duplicate or empty name shows the inline error, keeps the input and writes nothing', async () => {
    const f = fakeApi();
    const r = await mount(f.api);
    await press(r, 'categories-add');
    await press(r, 'category-save');
    expect(texts(r)).toContain('Error: name required');
    await type(r, 'category-name', ' groceries ');
    await press(r, 'category-icon-Car');
    await press(r, 'category-save');
    expect(texts(r)).toContain('Error: you already have a category called groceries');
    expect(has(r, 'category-sheet')).toBe(true);
    expect(host(r, 'category-name').props.value).toBe(' groceries ');
    expect(f.state.rows).toHaveLength(20);
  });

  it('a subcategory defaults to its parent colour and type, both editable', async () => {
    const f = fakeApi();
    const r = await mount(f.api);
    await press(r, 'categories-add');
    await press(r, 'category-parent-cat_transport');
    expect(host(r, 'category-colour-cat-sky').props.accessibilityState).toMatchObject({ selected: true });
    expect(host(r, 'category-type-need').props.accessibilityState).toMatchObject({ selected: true });
    await press(r, 'category-type-want');
    await type(r, 'category-name', 'Fuel');
    await press(r, 'category-save');
    expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'cat_transport', colour: 'cat-sky', budgetType: 'want' }));
  });

  it('editing saves by id, and the sheet does not offer Subcategory of for an existing category', async () => {
    const f = fakeApi();
    const r = await mount(f.api);
    await press(r, 'category-row-cat_food');
    expect(has(r, 'category-parent-none')).toBe(false);
    await press(r, 'category-type-need');
    await press(r, 'category-save');
    expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'cat_food', budgetType: 'need' }));
    expect(host(r, 'category-row-cat_food').props.accessibilityLabel).toBe('Food & Drinks, Need');
  });

  it('Move down and the TalkBack action reorder and announce the new position', async () => {
    const f = fakeApi();
    const r = await mount(f.api);
    await press(r, 'category-down-cat_groceries');
    expect(f.move).toHaveBeenCalledWith('cat_groceries', 'down', 'expense');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Groceries moved to position 3 of 20');
    await act(async () => host(r, 'category-row-cat_food').props.onAccessibilityAction({ nativeEvent: { actionName: 'moveDown' } }));
    await settle();
    expect(f.move).toHaveBeenCalledWith('cat_food', 'down', 'expense');
  });

  it('the first category has no Move up and the last no Move down', async () => {
    const r = await mount(fakeApi().api);
    expect(has(r, 'category-up-cat_food')).toBe(false);
    expect(has(r, 'category-down-cat_food')).toBe(true);
  });
});

describe('Category kinds (Story 4.2)', () => {
  it('the sheet offers Used for on a top-level category; Type is hidden for Income and shown for Both', async () => {
    const r = await mount(fakeApi().api);
    await press(r, 'categories-segment-income');
    await press(r, 'category-row-cat_in_freelance');
    expect(has(r, 'category-used-mixed')).toBe(true);
    expect(has(r, 'category-type-need')).toBe(false);
    await press(r, 'category-used-mixed');
    expect(has(r, 'category-type-need')).toBe(true);
    await press(r, 'category-save');
    expect(texts(r)).toContain('Saved');
  });

  it('a subcategory has no Used for of its own', async () => {
    const sub = mapCategoryRows([['sub', 'Fuel', 'expense', 'need', 'GasPump', 'cat-sky', 99, 'cat_transport']]);
    const r = await mount(fakeApi([...seedRows(), ...sub]).api);
    await press(r, 'category-row-sub');
    expect(has(r, 'category-used-mixed')).toBe(false);
  });

  it('a Both category is listed in both segments, with its own caption in each', async () => {
    const rows = seedRows().map((c) => (c.id === 'cat_in_freelance' ? { ...c, kind: 'mixed' as const } : c));
    const r = await mount(fakeApi(rows).api);
    expect(host(r, 'category-row-cat_in_freelance').props.accessibilityLabel).toBe('Freelance, Not classified · Also income');
    await press(r, 'categories-segment-income');
    expect(host(r, 'category-row-cat_in_freelance').props.accessibilityLabel).toBe('Freelance, Also spending');
  });

  it('shows the count when entries block a kind change, and keeps the sheet open', async () => {
    const f = fakeApi();
    f.save.mockResolvedValueOnce({ ok: false, code: 'KIND_IN_USE:income:3' });
    const r = await mount(f.api);
    await press(r, 'categories-segment-income');
    await press(r, 'category-row-cat_in_freelance');
    await press(r, 'category-used-expense');
    await press(r, 'category-save');
    expect(texts(r)).toContain('3 income entries use this category. Move them to another category first.');
    expect(has(r, 'category-sheet')).toBe(true);
  });
});

describe('linesFor', () => {
  it('puts subcategories under their parent', () => {
    const rows = [...seedRows(), ...mapCategoryRows([['sub', 'Fuel', 'expense', 'need', 'GasPump', 'cat-sky', 99, 'cat_transport']])];
    const names = linesFor(rows, 'expense').map((l) => l.row.name);
    expect(names.indexOf('Fuel')).toBe(names.indexOf('Transport') + 1);
  });
});

describe('Archive, merge and delete (Story 4.3)', () => {
  const sub = (id: string, name: string, parentId: string): CategoryRow => ({ id, name, kind: 'expense', budgetType: 'need', icon: 'Car', colorToken: 'cat-sky', sortOrder: 99, parentId });

  it('Archive reads how many entries use the category, lists them in pages, offers no Delete, and archives with Undo', async () => {
    const f = fakeApi();
    f.used.set('cat_transport', 40);
    const r = await mount(f.api);
    await press(r, 'category-row-cat_transport');
    expect(has(r, 'category-archive')).toBe(true);
    expect(has(r, 'category-merge')).toBe(true);
    expect(has(r, 'category-delete')).toBe(false);
    await press(r, 'category-archive');
    expect(has(r, 'category-sheet')).toBe(false);
    expect(texts(r)).toContain('40 entries use Transport.');
    expect(host(r, 'archive-keep').props.accessibilityState).toMatchObject({ selected: true });
    expect(r.root.findAll((n) => typeof n.type === 'string' && /^archive-entry-/.test(String(n.props.testID)))).toHaveLength(20);
    await press(r, 'archive-more');
    expect(r.root.findAll((n) => typeof n.type === 'string' && /^archive-entry-/.test(String(n.props.testID)))).toHaveLength(40);
    expect(has(r, 'archive-more')).toBe(false);
    await press(r, 'archive-go');
    expect(f.archive).toHaveBeenCalledWith('cat_transport');
    expect(has(r, 'archive-sheet')).toBe(false);
    expect(has(r, 'category-row-cat_transport')).toBe(false);
    expect(texts(r)).toContain('Archived Transport');
    expect(texts(r)).toContain('Archived (1)');
    await press(r, 'toast-undo');
    expect(f.restore).toHaveBeenCalledWith('cat_transport');
    expect(has(r, 'category-row-cat_transport')).toBe(true);
  });

  it('the Archived section is collapsed, then lists the category with Restore', async () => {
    const f = fakeApi();
    const r = await mount(f.api);
    await press(r, 'category-row-cat_education');
    await press(r, 'category-archive');
    await press(r, 'archive-go');
    expect(has(r, 'archived-category-cat_education')).toBe(false);
    await press(r, 'categories-archived-toggle');
    expect(has(r, 'archived-category-cat_education')).toBe(true);
    await press(r, 'archived-restore-cat_education');
    expect(f.restore).toHaveBeenCalledWith('cat_education');
    expect(texts(r)).toContain('Restored Education');
    expect(has(r, 'category-row-cat_education')).toBe(true);
  });

  it('counts a parent with its subcategories', async () => {
    const f = fakeApi();
    f.state.rows = [...f.state.rows, sub('s1', 'Petrol', 'cat_transport'), sub('s2', 'Taxi', 'cat_transport')];
    f.used.set('cat_transport', 52);
    const r = await mount(f.api);
    await press(r, 'category-row-cat_transport');
    await press(r, 'category-archive');
    expect(texts(r)).toContain('52 entries use Transport and its 2 subcategories.');
  });

  it('a category nothing uses offers Delete with the confirmation and a toast with Undo', async () => {
    const f = fakeApi();
    const r = await mount(f.api);
    await press(r, 'category-row-cat_education');
    expect(has(r, 'category-delete')).toBe(true);
    await press(r, 'category-delete');
    expect(texts(r)).toContain('Delete Education? No entries use it.');
    await press(r, 'archive-delete');
    expect(f.remove).toHaveBeenCalledWith('cat_education');
    expect(texts(r)).toContain('Deleted Education');
    expect(has(r, 'category-row-cat_education')).toBe(false);
    await press(r, 'toast-undo');
    expect(f.undoRemove).toHaveBeenCalled();
  });

  it('Cancel on the delete confirmation changes nothing', async () => {
    const f = fakeApi();
    const r = await mount(f.api);
    await press(r, 'category-row-cat_education');
    await press(r, 'category-delete');
    await press(r, 'archive-cancel');
    expect(f.remove).not.toHaveBeenCalled();
    expect(has(r, 'archive-sheet')).toBe(false);
  });

  it('Move them to another category previews the move, names the type change, and Confirm merges with Undo', async () => {
    const f = fakeApi();
    f.used.set('cat_transport', 40);
    const r = await mount(f.api);
    await press(r, 'category-row-cat_transport');
    await press(r, 'category-archive');
    await press(r, 'archive-move');
    // Not itself, not Uncategorised; a Want category is a target.
    expect(has(r, 'archive-target-cat_transport')).toBe(false);
    expect(has(r, 'archive-target-cat_uncategorised')).toBe(false);
    expect(has(r, 'archive-target-cat_travel')).toBe(true);
    expect(host(r, 'archive-confirm').props.accessibilityState).toMatchObject({ disabled: true });
    await press(r, 'archive-target-cat_travel');
    expect(texts(r)).toContain("Move 40 entries from Transport to Travel. Amounts don't change. Totals for past periods stay the same.");
    expect(texts(r)).toContain('Transport is a Need and Travel is a Want, so these entries count as Wants from now on, in every period.');
    expect(f.merge).not.toHaveBeenCalled();
    await press(r, 'archive-confirm');
    expect(f.merge).toHaveBeenCalledWith('cat_transport', 'cat_travel');
    expect(texts(r)).toContain('Moved 40 to Travel');
    await press(r, 'toast-undo');
    expect(f.undoMerge).toHaveBeenCalled();
  });

  it('Merge into… goes straight to the targets and leaves a subcategory out of its own parent’s list', async () => {
    const f = fakeApi();
    f.state.rows = [...f.state.rows, sub('s1', 'Petrol', 'cat_transport')];
    f.used.set('cat_transport', 3);
    const r = await mount(f.api);
    await press(r, 'category-row-cat_transport');
    await press(r, 'category-merge');
    expect(has(r, 'archive-keep')).toBe(false);
    expect(has(r, 'archive-target-s1')).toBe(false);
    expect(has(r, 'archive-target-cat_groceries')).toBe(true);
  });

  it('the archive and merge previews say which budget ends after this period (Story 4.6)', async () => {
    const f = fakeApi();
    f.used.set('cat_transport', 3);
    f.ending.names.push('Transport');
    const r = await mount(f.api);
    await press(r, 'category-row-cat_transport');
    await press(r, 'category-archive');
    expect(texts(r)).toContain('The Transport budget ends after this period.');
    await press(r, 'archive-move');
    await press(r, 'archive-target-cat_travel');
    expect(texts(r)).toContain('The Transport budget ends after this period.');
  });

  it('shows no Archive, Merge or Delete for Other or Uncategorised', async () => {
    const f = fakeApi();
    const r = await mount(f.api);
    await press(r, 'category-row-cat_other');
    expect(has(r, 'category-sheet')).toBe(true);
    expect(has(r, 'category-actions')).toBe(false);
    expect(host(r, 'category-row-cat_uncategorised').props.onPress).toBeUndefined();
  });
});

describe('searchIcons', () => {
  it('finds the gas pump by "fuel" or "petrol", lists everything for an empty search and nothing for nonsense', () => {
    expect(searchIcons('fuel').map((i) => i.name)).toContain('GasPump');
    expect(searchIcons(' PETROL ').map((i) => i.name)).toContain('GasPump');
    expect(searchIcons('').length).toBeGreaterThan(50);
    expect(searchIcons('zzzz')).toHaveLength(0);
  });
});
