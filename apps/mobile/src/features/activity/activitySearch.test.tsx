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
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
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
const wait = (ms: number) => act(async () => new Promise((res) => setTimeout(res, ms)));
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const type = (r: ReactTestRenderer, id: string, v: string) => act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(v));

const row = (id: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id, kind: 'expense', amountMinor: 45000, localDate: '2026-11-07', merchant: 'Swiggy', categoryName: 'Food & Drinks', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: 'HDFC', ...over,
});
const OPTIONS: ActivityOptions = {
  accounts: [
    { id: 'a1', name: 'HDFC', type: 'bank', icon: 'Bank', colorToken: 'cat-indigo', sortOrder: 0, status: 'active', balanceNotSet: false, postingsMinor: 0 },
    { id: 'a2', name: 'Old SBI', type: 'bank', icon: 'Bank', colorToken: 'cat-indigo', sortOrder: 1, status: 'archived', balanceNotSet: false, postingsMinor: 0 },
  ],
  categories: [{ id: 'cat_food', name: 'Food & Drinks', kind: 'expense', budgetType: 'need', icon: 'ForkKnife', color: 'cat-rose', sortOrder: 0 } as never],
  today: '2026-11-08',
  period: { start: '2026-11-01', end: '2026-11-30' },
};

function fakeApi(rows: ActivityRow[]) {
  const load = jest.fn<Promise<ActivityData | null>, [number?, ActivityQuery?]>(async () => ({ currency: 'INR', locale: 'en-IN', today: '2026-11-08', days: groupByDay(rows), hasMore: false }));
  const count = jest.fn<Promise<number>, [ActivityQuery]>(async () => 3);
  const api: ActivityApi = { load, options: async () => OPTIONS, count };
  return { api, load, count };
}

async function mountActivity(rows: ActivityRow[] = [row('a'), row('b', { merchant: 'Chai Point', localDate: '2026-11-06' })]) {
  const f = fakeApi(rows);
  const qc = createQueryClient();
  clients.push(qc);
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <ActivityScreen api={f.api} onAccounts={() => undefined} onProfile={() => undefined} onAdd={() => undefined} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, ...f };
}
const lastQuery = (load: jest.Mock) => load.mock.calls[load.mock.calls.length - 1]![1];

describe('search (Story 3.6)', () => {
  it('Search replaces the title with a field and Clear; results follow typing after 300 ms; Back closes and clears', async () => {
    const m = await mountActivity();
    await press(m.r, 'header-search');
    expect(host(m.r, 'search-input').props.placeholder).toBe('Search merchant, note, category or amount');
    expect(texts(m.r)).not.toContain('Activity');
    type(m.r, 'search-input', 'chai');
    expect(lastQuery(m.load)).toEqual({});
    await wait(350);
    await settle();
    expect(lastQuery(m.load)).toEqual({ search: 'chai' });
    expect(has(m.r, 'search-clear')).toBe(true);
    await press(m.r, 'search-clear');
    expect(host(m.r, 'search-input').props.value).toBe('');
    await wait(350);
    await settle();
    expect(useUiStore.getState().activityFilter.query).toEqual({});
    type(m.r, 'search-input', 'tea');
    await wait(350);
    expect(useUiStore.getState().activityFilter.query).toEqual({ search: 'tea' });
    await press(m.r, 'search-back');
    expect(texts(m.r)).toContain('Activity');
    expect(useUiStore.getState().activityFilter.query).toEqual({});
  });
});

describe('filter chips (Story 3.6)', () => {
  const withFilters = (query: ActivityQuery, datePreset: '7d' | null = null) => useUiStore.setState({ activityFilter: { query, datePreset } });

  it('shows Filters · N, one removable chip per active filter, and Clear all once two are active', async () => {
    withFilters({ fromDate: '2026-11-02', toDate: '2026-11-08', accountIds: ['a1'] }, '7d');
    const m = await mountActivity();
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Filters · 2', 'Last 7 days', 'HDFC', 'Clear all']));
    expect(host(m.r, 'chip-account-a1').props.accessibilityLabel).toBe('Remove filter: HDFC');
    expect(host(m.r, 'filters-button').props.accessibilityLabel).toBe('Filters, 2');
  });

  it('removing a chip updates the query and the count; with one filter left there is no Clear all', async () => {
    withFilters({ fromDate: '2026-11-02', toDate: '2026-11-08', accountIds: ['a1'] }, '7d');
    const m = await mountActivity();
    await press(m.r, 'chip-account-a1');
    expect(lastQuery(m.load)).toEqual({ fromDate: '2026-11-02', toDate: '2026-11-08', accountIds: [] });
    expect(texts(m.r)).toContain('Filters · 1');
    expect(has(m.r, 'chips-clear-all')).toBe(false);
  });

  it('Clear all resets every filter and the search', async () => {
    withFilters({ accountIds: ['a1'], types: ['expense'], search: 'x' });
    const m = await mountActivity();
    await press(m.r, 'chips-clear-all');
    expect(lastQuery(m.load)).toEqual({});
    expect(texts(m.r)).toContain('Filters · 0');
  });

  it('filters that match nothing show "No matches · Clear all", and Clear all brings the list back', async () => {
    withFilters({ search: 'zzz' });
    const m = await mountActivity([]);
    expect(texts(m.r)).toContain('No matches · Clear all');
    await press(m.r, 'no-matches-clear');
    expect(lastQuery(m.load)).toEqual({});
  });

  it('with no entries and no filters it is the normal empty state, not "No matches"', async () => {
    const m = await mountActivity([]);
    expect(has(m.r, 'no-matches')).toBe(false);
    expect(texts(m.r)).toContain('Nothing here yet. Your first expense will show up in this list.');
  });
});

describe('the filter sheet (Story 3.6)', () => {
  it('offers Date, Accounts (archived apart), Categories, Type, Status, Amount, Show rejected and Sort with Reset and Show N results', async () => {
    const m = await mountActivity();
    await press(m.r, 'filters-button');
    await settle();
    expect(has(m.r, 'filter-sheet')).toBe(true);
    const t = texts(m.r);
    expect(t).toEqual(expect.arrayContaining(['Date', 'This period', 'Last 7 days', 'Last 30 days', 'Custom range', 'Accounts', 'Archived', 'Old SBI', 'Categories', 'Type', 'Expense', 'Income', 'Transfer', 'Refund', 'Status', 'Waiting for you', 'Possible duplicate', 'Needs a category', 'Guessed', 'Reversed', 'Amount', 'Show rejected', 'Rejected captures from the last 90 days', 'Sort', 'Newest first', 'Oldest first', 'Highest amount', 'Merchant A–Z', 'Reset', 'Show 3 results']));
  });

  it('applying returns to Activity with the chosen filters as chips; the preset means the right dates', async () => {
    const m = await mountActivity();
    await press(m.r, 'filters-button');
    await settle();
    await press(m.r, 'filter-date-7d');
    await press(m.r, 'filter-account-a1');
    await press(m.r, 'filter-type-expense');
    await press(m.r, 'filter-sort-oldest');
    await press(m.r, 'filter-apply');
    await settle();
    expect(lastQuery(m.load)).toEqual({ fromDate: '2026-11-02', toDate: '2026-11-08', accountIds: ['a1'], types: ['expense'], sort: 'oldest' });
    expect(useUiStore.getState().activityFilter.datePreset).toBe('7d');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Filters · 3', 'Last 7 days', 'HDFC', 'Expense']));
    expect(has(m.r, 'filter-sheet')).toBe(false);
  });

  it('This period uses the profile period; amount and Show rejected are applied; Reset clears the draft', async () => {
    const m = await mountActivity();
    await press(m.r, 'filters-button');
    await settle();
    await press(m.r, 'filter-date-period');
    type(m.r, 'filter-min', '100');
    type(m.r, 'filter-max', '500.50');
    act(() => m.r.root.findAll((n) => n.props.testID === 'filter-rejected' && typeof n.props.onValueChange === 'function')[0]!.props.onValueChange(true));
    await settle();
    await press(m.r, 'filter-apply');
    await settle();
    expect(lastQuery(m.load)).toEqual({ fromDate: '2026-11-01', toDate: '2026-11-30', minMinor: 10000, maxMinor: 50050, showRejected: true });
    await press(m.r, 'filters-button');
    await settle();
    await press(m.r, 'filter-reset');
    expect(host(m.r, 'filter-min').props.value).toBe('');
    await press(m.r, 'filter-apply');
    await settle();
    expect(useUiStore.getState().activityFilter.query).toEqual({});
  });

  it('a search stays when filters are applied', async () => {
    useUiStore.setState({ activityFilter: { query: { search: 'chai' }, datePreset: null } });
    const m = await mountActivity();
    await press(m.r, 'filters-button');
    await settle();
    await press(m.r, 'filter-type-income');
    await press(m.r, 'filter-apply');
    await settle();
    expect(lastQuery(m.load)).toEqual({ search: 'chai', types: ['income'] });
  });
});

describe('sort (Story 3.6)', () => {
  it('Highest amount or Merchant A to Z is a flat list: no day headers or Spent, the date is in each row subtitle', async () => {
    useUiStore.setState({ activityFilter: { query: { sort: 'amount' }, datePreset: null } });
    const m = await mountActivity();
    expect(has(m.r, 'day-2026-11-07')).toBe(false);
    expect(texts(m.r)).not.toContain('Spent');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Food & Drinks · HDFC · Sat 7 Nov']));
  });

  it('newest and oldest keep the day headers with Spent', async () => {
    useUiStore.setState({ activityFilter: { query: { sort: 'oldest' }, datePreset: null } });
    const m = await mountActivity();
    expect(has(m.r, 'day-2026-11-07')).toBe(true);
    expect(texts(m.r)).toContain('Spent');
  });

  it('the filter state lives in transient UI state and starts empty', () => {
    expect(useUiStore.getState().activityFilter).toEqual(EMPTY_ACTIVITY_FILTER);
  });
});
