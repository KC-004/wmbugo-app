import { AccessibilityInfo, Text, useWindowDimensions } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { groupByDay, type ActivityRow } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { MemorySeenStore } from '../../shared/feedback/tooltipController';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { ActivityScreen } from '../activity/ActivityScreen';
import type { ActivityApi, ActivityData } from '../activity/activityApi';
import { HomeScreen } from './HomeScreen';
import type { HomeApi, HomeData } from './homeApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 400, height: 800, scale: 2, fontScale: mockFontScale }),
}));

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];
afterEach(async () => {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
  jest.restoreAllMocks();
  mockFontScale = 1;
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});
void useWindowDimensions;

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);
const fire = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress();

function mount(node: React.ReactElement) {
  const qc = createQueryClient();
  clients.push(qc);
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <SheetHost>{node}</SheetHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  return { r, qc };
}

const data = (over: Partial<HomeData> = {}, accounts: Partial<HomeData['accounts']> = {}): HomeData => ({
  currency: 'SGD',
  locale: 'en-SG',
  timezoneId: 'Asia/Singapore',
  today: '2026-11-07',
  hour: 9,
  scope: 'This month',
  spentMinor: 1250,
  accounts: { hasAccounts: true, inAccountsMinor: 320000, notSetCount: 0, cardDuesMinor: null, ...accounts },
  ...over,
});
const homeApi = (d: HomeData | null, seen = new MemorySeenStore()): HomeApi & { load: jest.Mock } => ({ load: jest.fn(async () => d), seen });
const noop = () => undefined;
const mountHome = async (api: HomeApi, onAddAccount = noop) => {
  const m = mount(<HomeScreen api={api} onAccounts={noop} onProfile={noop} onAddAccount={onAddAccount} />);
  await settle();
  return m;
};

describe('Home', () => {
  it('shows a greeting, today, Spent this period with the scope, and the accounts line', async () => {
    const { r } = await mountHome(homeApi(data()));
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['Good morning', 'Sat 7 Nov', 'Spent this period', 'S$12.50', 'This month', 'In accounts', 'S$3,200.00']));
    expect(t).not.toContain('Card dues');
    expect(t.join(' ')).not.toMatch(/set a limit/i);
  });

  it('shows skeletons while loading, then the values', async () => {
    let release!: (d: HomeData) => void;
    const api: HomeApi = { load: () => new Promise((res) => { release = res; }), seen: new MemorySeenStore() };
    const { r } = mount(<HomeScreen api={api} onAccounts={noop} onProfile={noop} onAddAccount={noop} />);
    await settle();
    expect(host(r, 'home-skeleton')).toHaveLength(1);
    await act(async () => release(data()));
    await settle();
    expect(host(r, 'home-skeleton')).toHaveLength(0);
    expect(texts(r)).toContain('Spent this period');
  });

  it('shows In accounts and Card dues side by side, never summed, and stacks at fontScale 1.3', async () => {
    const a = await mountHome(homeApi(data({}, { cardDuesMinor: 25000 })));
    expect(texts(a.r)).toEqual(expect.arrayContaining(['In accounts', 'Card dues', 'S$3,200.00', 'S$250.00']));
    expect(texts(a.r)).not.toContain('S$3,450.00');
    expect(host(a.r, 'accounts-line')[0]!.props.style.flat().some((s: { flexDirection?: string }) => s?.flexDirection === 'row')).toBe(true);
    mockFontScale = 1.3;
    const b = await mountHome(homeApi(data({}, { cardDuesMinor: 25000 })));
    expect(host(b.r, 'accounts-line')[0]!.props.style.flat().some((s: { flexDirection?: string }) => s?.flexDirection === 'column')).toBe(true);
  });

  it('with no account, says to set one up and offers to add one', async () => {
    const add = jest.fn();
    const { r } = await mountHome(homeApi(data({}, { hasAccounts: false, inAccountsMinor: null })), add);
    expect(texts(r)).toContain('Set up an account to calculate your balance');
    act(() => fire(r, 'home-add-account'));
    expect(add).toHaveBeenCalled();
    expect(texts(r)).not.toContain('In accounts');
  });

  it('with an unset balance never shows zero, and adds +1 account not set', async () => {
    const { r } = await mountHome(homeApi(data({}, { inAccountsMinor: null, notSetCount: 1 })));
    expect(texts(r)).toEqual(expect.arrayContaining(['Not set', '+1 account not set']));
    expect(texts(r).join(' ')).not.toContain('S$0.00 ');
    const b = await mountHome(homeApi(data({}, { inAccountsMinor: 1000, notSetCount: 2 })));
    expect(texts(b.r)).toContain('+2 accounts not set');
  });

  it('shows the In accounts tip once, and "Got it" records it so it never returns', async () => {
    const seen = new MemorySeenStore();
    const a = await mountHome(homeApi(data(), seen));
    expect(texts(a.r)).toContain("This is money in accounts you've added");
    await act(async () => fire(a.r, 'tooltip-got-it'));
    await settle();
    expect(host(a.r, 'tooltip')).toHaveLength(0);
    expect(seen.seen.has('tip.in-accounts')).toBe(true);
    const b = await mountHome(homeApi(data(), seen));
    expect(host(b.r, 'tooltip')).toHaveLength(0);
  });

  it('refetches when the home area is invalidated', async () => {
    const api = homeApi(data());
    const { qc } = await mountHome(api);
    api.load.mockResolvedValue(data({ spentMinor: 9900 }));
    await act(async () => qc.invalidateQueries({ queryKey: ['home'] }));
    await settle();
    expect(api.load).toHaveBeenCalledTimes(2);
  });
});

const row = (id: string, kind: ActivityRow['kind'], amountMinor: number, localDate: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id, kind, amountMinor, localDate, merchant: null, categoryName: 'Food & Drinks', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: 'DBS', ...over,
});
const activity = (rows: ActivityRow[]): ActivityData => ({ currency: 'SGD', locale: 'en-SG', today: '2026-11-07', days: groupByDay(rows), hasMore: false });
const mountActivity = async (d: ActivityData, onAdd = noop) => {
  const api: ActivityApi = { load: async () => d };
  const m = mount(<ActivityScreen api={api} onAccounts={noop} onProfile={noop} onAdd={onAdd} />);
  await settle();
  return m;
};

describe('Activity', () => {
  const rows = [
    row('a', 'expense', 1250, '2026-11-07', { merchant: 'Kopi' }),
    row('b', 'income', 500000, '2026-11-07', { categoryName: 'Salary', categoryIcon: 'Briefcase', categoryColor: 'cat-emerald' }),
    row('c', 'expense', 800, '2026-11-06'),
    row('d', 'transfer', 5000, '2026-11-05', { categoryName: null, categoryIcon: null, categoryColor: null }),
  ];

  it('groups by day with Today / Yesterday headings and a right-aligned Spent total', async () => {
    const { r } = await mountActivity(activity(rows));
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['Today · Sat 7 Nov', 'Yesterday · Fri 6 Nov', 'Thu 5 Nov', 'S$12.50', 'S$8.00', 'S$0.00']));
    expect(t.filter((x) => x === 'Spent')).toHaveLength(3);
  });

  it('rows show merchant or category, "Category · Account", and unsigned expenses, + income, unsigned transfers; never a minus', async () => {
    const { r } = await mountActivity(activity(rows));
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['Kopi', 'Food & Drinks · DBS', 'Salary', '+S$5,000.00', 'Transfer', 'S$50.00']));
    expect(t.join(' ')).not.toMatch(/[-−–]\s?S\$/);
  });

  it('reads merchant, amount with direction, category, account and date for TalkBack; day headers are headings', async () => {
    const { r } = await mountActivity(activity(rows));
    expect(host(r, 'activity-row-a')[0]!.props.accessibilityLabel).toBe('Kopi, spent 12.50 Singapore dollars, Food & Drinks, DBS, Saturday 7 November');
    expect(host(r, 'activity-row-b')[0]!.props.accessibilityLabel).toContain('income, plus 5,000 Singapore dollars');
    const header = host(r, 'day-2026-11-07')[0]!.props;
    expect(header.accessibilityRole).toBe('header');
    expect(header.accessibilityLabel).toBe('Saturday 7 November, spent 12.50 Singapore dollars');
  });

  it('stacks the day header and amounts at fontScale 1.3', async () => {
    mockFontScale = 1.3;
    const { r } = await mountActivity(activity(rows));
    expect(host(r, 'day-2026-11-07')[0]!.props.style.flat().some((s: { flexDirection?: string }) => s?.flexDirection === 'column')).toBe(true);
  });

  it('offers Show earlier entries when there are more, and asks for a bigger page', async () => {
    const load = jest.fn(async (limit?: number) => ({ ...activity(rows), hasMore: (limit ?? 100) < 200 }));
    mount(<ActivityScreen api={{ load }} onAccounts={noop} onProfile={noop} onAdd={noop} />);
    await settle();
    expect(load).toHaveBeenLastCalledWith(100);
    const r = live[live.length - 1]!;
    expect(host(r, 'activity-show-earlier')).toHaveLength(1);
    await act(async () => fire(r, 'activity-show-earlier'));
    await settle();
    expect(load).toHaveBeenLastCalledWith(200);
    expect(host(r, 'activity-show-earlier')).toHaveLength(0);
  });

  it('with no entries shows the boat empty state and Add an expense', async () => {
    const add = jest.fn();
    const { r } = await mountActivity(activity([]), add);
    expect(host(r, 'empty-state')).toHaveLength(1);
    act(() => fire(r, 'empty-state-action'));
    expect(add).toHaveBeenCalled();
  });
});
