import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { groupByDay, type ActivityQuery, type ActivityRow } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { EMPTY_ACTIVITY_FILTER, useUiStore } from '../../shared/state/uiStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { ActivityScreen } from './ActivityScreen';
import type { ActivityApi, ActivityData, ActivityOptions } from './activityApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0 } }));

const live: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  useUiStore.setState({ activityFilter: EMPTY_ACTIVITY_FILTER });
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
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const hostOf = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const longPress = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onLongPress === 'function')[0]!.props.onLongPress());
  await settle();
};

const row = (id: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id, kind: 'expense', amountMinor: 45000, localDate: '2026-11-07', merchant: 'HP Petrol', categoryName: 'Other', categoryIcon: 'DotsThree', categoryColor: 'cat-slate', accountName: 'HDFC', ...over,
});
const OPTIONS: ActivityOptions = {
  accounts: [],
  categories: [
    { id: 'cat_other', name: 'Other', kind: 'expense', budgetType: null, icon: 'DotsThree', color: 'cat-slate', sortOrder: 9 } as never,
    { id: 'cat_transport', name: 'Transport', kind: 'expense', budgetType: 'need', icon: 'Car', color: 'cat-sky', sortOrder: 1 } as never,
  ],
  today: '2026-11-08',
  period: { start: '2026-11-01', end: '2026-11-30' },
};

async function mountActivity(rows: ActivityRow[], over: Partial<ActivityApi> = {}) {
  const load = jest.fn<Promise<ActivityData | null>, [number?, ActivityQuery?]>(async () => ({ currency: 'INR', locale: 'en-IN', today: '2026-11-08', days: groupByDay(rows), hasMore: false }));
  const ids = jest.fn(async () => ['a', 'b', 'c', 'not-loaded-1', 'not-loaded-2']);
  const bulkPreview = jest.fn(async (sel: readonly string[]) => ({ movable: sel.length - 1, wontChange: 1, fromCategoryId: 'cat_other' as string | null }));
  const bulkMove = jest.fn(async (sel: readonly string[]) => ({ ok: true as const, value: { movedIds: sel.slice(1) as string[], skipped: 1, previous: sel.slice(1).map((id) => ({ id, categoryId: 'cat_other' })) } }));
  const bulkUndo = jest.fn(async () => ({ ok: true }));
  const api: ActivityApi = { load, options: async () => OPTIONS, ids, bulkPreview, bulkMove, bulkUndo, ...over };
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <ActivityScreen api={api} onAccounts={() => undefined} onProfile={() => undefined} onAdd={() => undefined} onOpen={() => undefined} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, ids, bulkPreview, bulkMove, bulkUndo };
}

describe('select many and move (Story 3.9)', () => {
  it('Select starts selection mode: the bar replaces the header, rows become checkboxes with selected / not selected', async () => {
    const m = await mountActivity([row('a'), row('b'), row('c')]);
    await press(m.r, 'header-select');
    expect(has(m.r, 'selection-bar')).toBe(true);
    expect(texts(m.r)).toEqual(expect.arrayContaining(['0 selected', 'Select all', 'Move 0 to…']));
    expect(texts(m.r)).not.toContain('Activity');
    await press(m.r, 'activity-row-a');
    expect(texts(m.r)).toContain('1 selected');
    const a = hostOf(m.r, 'activity-row-a');
    expect(a.props.accessibilityRole).toBe('checkbox');
    expect(a.props.accessibilityState).toEqual({ checked: true });
    expect(a.props.accessibilityLabel).toMatch(/, selected$/);
    expect(hostOf(m.r, 'activity-row-b').props.accessibilityLabel).toMatch(/, not selected$/);
    expect(has(m.r, 'checkbox-a')).toBe(true);
  });

  it('a long press starts selection with that row selected; ✕ ends it and changes nothing', async () => {
    const m = await mountActivity([row('a'), row('b')]);
    await longPress(m.r, 'activity-row-b');
    expect(texts(m.r)).toContain('1 selected');
    await press(m.r, 'selection-cancel');
    expect(has(m.r, 'selection-bar')).toBe(false);
    expect(texts(m.r)).toContain('Activity');
    expect(m.bulkMove).not.toHaveBeenCalled();
  });

  it('Select all selects the whole filtered set, rows not loaded included', async () => {
    const m = await mountActivity([row('a'), row('b'), row('c')]);
    await press(m.r, 'header-select');
    await press(m.r, 'selection-all');
    expect(m.ids).toHaveBeenCalled();
    expect(texts(m.r)).toContain('5 selected');
  });

  it('Move → Transport shows the preview with the sources and the won\'t-change line; Confirm moves, exits selection and toasts Moved with Undo', async () => {
    const m = await mountActivity([row('a'), row('b'), row('c')]);
    await press(m.r, 'header-select');
    await press(m.r, 'selection-all');
    await press(m.r, 'selection-move');
    await press(m.r, 'bulk-cat-cat_transport');
    expect(m.bulkPreview).toHaveBeenCalledWith(['a', 'b', 'c', 'not-loaded-1', 'not-loaded-2'], 'cat_transport');
    const t = texts(m.r);
    expect(t).toContain("Move 4 from Other to Transport. Amounts don't change.");
    expect(t).toContain("1 entry won't change: transfers, splits, refunds, entries still to check or entries that don't fit this category.");
    await press(m.r, 'bulk-confirm');
    expect(m.bulkMove).toHaveBeenCalledWith(['a', 'b', 'c', 'not-loaded-1', 'not-loaded-2'], 'cat_transport');
    expect(has(m.r, 'selection-bar')).toBe(false);
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Moved 4 to Transport', 'Undo']));
    await press(m.r, 'toast-undo');
    expect(m.bulkUndo).toHaveBeenCalledWith([{ id: 'b', categoryId: 'cat_other' }, { id: 'c', categoryId: 'cat_other' }, { id: 'not-loaded-1', categoryId: 'cat_other' }, { id: 'not-loaded-2', categoryId: 'cat_other' }]);
  });

  it('mixed sources read "Move N to Transport" without a from', async () => {
    const m = await mountActivity([row('a'), row('b')], { bulkPreview: async () => ({ movable: 2, wontChange: 0, fromCategoryId: null }) });
    await longPress(m.r, 'activity-row-a');
    await press(m.r, 'selection-move');
    await press(m.r, 'bulk-cat-cat_transport');
    expect(texts(m.r)).toContain("Move 2 to Transport. Amounts don't change.");
    expect(has(m.r, 'bulk-wont-change')).toBe(false);
  });
});
