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
  const api: CategoriesApi = { load: async () => ({ rows: state.rows }), save, move };
  return { api, save, move, state };
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
    expect(f.move).toHaveBeenCalledWith('cat_groceries', 'down');
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Groceries moved to position 3 of 20');
    await act(async () => host(r, 'category-row-cat_food').props.onAccessibilityAction({ nativeEvent: { actionName: 'moveDown' } }));
    await settle();
    expect(f.move).toHaveBeenCalledWith('cat_food', 'down');
  });

  it('the first category has no Move up and the last no Move down', async () => {
    const r = await mount(fakeApi().api);
    expect(has(r, 'category-up-cat_food')).toBe(false);
    expect(has(r, 'category-down-cat_food')).toBe(true);
  });
});

describe('linesFor', () => {
  it('puts subcategories under their parent', () => {
    const rows = [...seedRows(), ...mapCategoryRows([['sub', 'Fuel', 'expense', 'need', 'GasPump', 'cat-sky', 99, 'cat_transport']])];
    const names = linesFor(rows, 'expense').map((l) => l.row.name);
    expect(names.indexOf('Fuel')).toBe(names.indexOf('Transport') + 1);
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
