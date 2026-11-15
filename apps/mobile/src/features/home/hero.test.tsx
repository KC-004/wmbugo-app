import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { MemorySeenStore } from '../../shared/feedback/tooltipController';
import { createQueryClient } from '../../shared/queryClient';
import { colorTokens } from '../../shared/theme/colors';
import { composite, contrastRatio, parseHex } from '../../shared/theme/contrast';
import { ThemeProvider, type ThemeMode } from '../../shared/theme/ThemeProvider';
import { HeroBar, heroBarGeometry } from './HeroBar';
import { HomeScreen } from './HomeScreen';
import type { HomeApi, HomeData } from './homeApi';
import { homeData } from './homeTestKit';
import { homeHeroNav } from './homeNav';
import { moneyLeaks } from '../../shared/moneyLeaks.testkit';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import type { SettingsApi } from '../settings/settingsApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Kolkata' } }));
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
  useAmountsStore.getState().setHidden(false);
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
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id);
const press = (r: ReactTestRenderer, id: string) => act(() => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());

const settingsFake = (ok = true) => ({ setHideAmounts: jest.fn(async () => ({ ok })), timezoneCheck: async () => null }) as unknown as SettingsApi & { setHideAmounts: jest.Mock };
const nav = () => ({ onAccounts: jest.fn(), onProfile: jest.fn(), onAddAccount: jest.fn(), onOpenBudget: jest.fn(), onOpenPlan: jest.fn(), onSetLimit: jest.fn(), onSortIt: jest.fn(), onOpenReview: jest.fn(), onOpenActivity: jest.fn(), onEditHome: jest.fn() });

async function mountHero(d: HomeData, mode: ThemeMode = 'light', settings = settingsFake()) {
  const qc = createQueryClient();
  clients.push(qc);
  const api: HomeApi = { load: async () => d, seen: new MemorySeenStore() };
  const n = nav();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider initialMode={mode}>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <HomeScreen api={api} settingsApi={settings} {...n} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, n, settings };
}

const ACCOUNTS = { hasAccounts: true, inAccountsMinor: 5_230_000, notSetCount: 0, cardDuesMinor: 410_000, notSetCards: 0 };
const UNDER = homeData({
  currency: 'INR',
  accounts: ACCOUNTS,
  summary: { heroMode: 'overall', leftMinor: 1_186_000, usedMinor: 814_000, targetMinor: 2_000_000, daysLeft: 12, daysToPayday: 12, overallBudgetId: 'b1', spentThisPeriodMinor: 814_000 },
});
const OVER = homeData({
  currency: 'INR',
  accounts: ACCOUNTS,
  summary: { heroMode: 'overall', leftMinor: -234_000, usedMinor: 2_234_000, targetMinor: 2_000_000, daysLeft: 5, daysToPayday: 5, overallBudgetId: 'b1', spentThisPeriodMinor: 2_234_000 },
});
const TYPES = homeData({
  currency: 'INR',
  accounts: ACCOUNTS,
  summary: {
    heroMode: 'nws_only', leftMinor: 1_200_000, usedMinor: 2_800_000, targetMinor: 4_000_000, notClassifiedMinor: 300_000,
    sortIt: { categoryIds: ['c1', 'c2'], fromDate: '2026-11-01', toDate: '2026-11-30' }, daysLeft: 12, daysToPayday: 12,
  },
});
const NONE = homeData({ currency: 'INR', accounts: ACCOUNTS, summary: { spentThisPeriodMinor: 120_000 } });

describe('heroBarGeometry (UX-DR24)', () => {
  it('50% fills half to a tick at the end of the track; no overflow', () => {
    expect(heroBarGeometry(50, 100)).toEqual({ fill: 0.5, tick: 1, overflow: 0 });
  });
  it('100% fills the track; no overflow', () => {
    expect(heroBarGeometry(100, 100)).toEqual({ fill: 1, tick: 1, overflow: 0 });
  });
  it('112% shows a 12% overflow and the fill stops at the tick', () => {
    const g = heroBarGeometry(112, 100);
    expect(g.overflow).toBeCloseTo(0.12, 10);
    expect(g.tick).toBeCloseTo(0.88, 10);
    expect(g.fill).toBeCloseTo(g.tick, 10);
  });
  it('300% is capped at exactly 20% of the track', () => {
    expect(heroBarGeometry(300, 100)).toEqual({ fill: 0.8, tick: 0.8, overflow: 0.2 });
  });
  it('a zero limit with spending shows the capped overflow, and with none shows an empty bar', () => {
    expect(heroBarGeometry(500, 0).overflow).toBe(0.2);
    expect(heroBarGeometry(0, 0)).toEqual({ fill: 0, tick: 1, overflow: 0 });
  });
  it('a non-finite figure draws an empty bar, never NaN', () => {
    expect(heroBarGeometry(Number.NaN, 100)).toEqual({ fill: 0, tick: 1, overflow: 0 });
  });
});

describe('HeroBar rendering', () => {
  const render = (used: number, target: number, hidden = false, mode: ThemeMode = 'light') => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ThemeProvider initialMode={mode}>
          <HeroBar usedMinor={used} targetMinor={target} hidden={hidden} />
        </ThemeProvider>,
      );
    });
    live.push(r);
    return r;
  };
  it.each([
    [50, '50%', undefined],
    [100, '100%', undefined],
    [112, '88%', '12%'],
    [300, '80%', '20%'],
  ])('at %i%% spent the fill is %s and the overflow %s', (pct, fill, overflow) => {
    const r = render(pct, 100);
    expect(StyleSheet.flatten(host(r, 'hero-bar-fill')[0]!.props.style)).toMatchObject({ width: fill });
    if (overflow) expect(StyleSheet.flatten(host(r, 'hero-bar-overflow')[0]!.props.style)).toMatchObject({ width: overflow });
    else expect(host(r, 'hero-bar-overflow')).toHaveLength(0);
  });
  it('masked: the track stays and nothing else is drawn', () => {
    const r = render(112, 100, true);
    expect(host(r, 'hero-bar-track')).toHaveLength(1);
    expect(host(r, 'hero-bar-fill')).toHaveLength(0);
    expect(host(r, 'hero-bar-tick')).toHaveLength(0);
    expect(host(r, 'hero-bar-overflow')).toHaveLength(0);
  });
  it('fill against track meets 3.70:1 in light and 3.43:1 in dark', () => {
    const track = (ink: string, surface: string) => {
      const t = { ...parseHex(ink), a: 0.16 };
      const c = composite(t, parseHex(surface));
      const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
      return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
    };
    expect(contrastRatio(colorTokens['on-glass-primary'], track(colorTokens['on-glass-primary'], colorTokens['glass-fallback']))).toBeGreaterThanOrEqual(3.7);
    expect(contrastRatio(colorTokens['on-glass-accent'], track(colorTokens['on-glass-primary'], colorTokens['glass-fallback-dark']))).toBeGreaterThanOrEqual(3.43);
  });
});

describe('hero states (Story 5.2)', () => {
  it('under: label, amount, caption, daily line and the accounts side by side', async () => {
    const { r } = await mountHero(UNDER);
    expect(texts(r)).toEqual(expect.arrayContaining(['Left in budget', '₹11,860.00', '₹8,140.00 of ₹20,000.00', '~₹988.00/day · 12 days to payday', 'In accounts', '₹52,300.00', 'Card dues', '₹4,100.00']));
    expect(StyleSheet.flatten(host(r, 'hero-bar-fill')[0]!.props.style)).toMatchObject({ width: '40.7%' });
    expect(host(r, 'hero-bar-overflow')).toHaveLength(0);
    expect(texts(r)).not.toContain('Set a limit →');
  });

  it('over: warning, unsigned amount, days only and no per-day figure', async () => {
    const { r } = await mountHero(OVER);
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['Over budget', '₹2,340.00', '₹22,340.00 of ₹20,000.00', '5 days to payday']));
    expect(t.some((x) => x.includes('/day'))).toBe(false);
    expect(host(r, 'hero-bar-overflow')).toHaveLength(1);
  });

  it('50/30/20 only: Left in budget with the not classified row and Sort it', async () => {
    const { r, n } = await mountHero(TYPES);
    expect(texts(r)).toEqual(expect.arrayContaining(['Left in budget', '₹12,000.00', 'Includes ₹3,000.00 not classified · ', 'Sort it']));
    press(r, 'hero-sort-it');
    expect(n.onSortIt).toHaveBeenCalledWith({ categoryIds: ['c1', 'c2'], fromDate: '2026-11-01', toDate: '2026-11-30' });
  });

  it('no budget: Spent this period, no bar, no daily line, and Set a limit', async () => {
    const { r, n } = await mountHero(NONE);
    expect(texts(r)).toEqual(expect.arrayContaining(['Spent this period', '₹1,200.00', 'Set a limit →']));
    expect(host(r, 'hero-bar')).toHaveLength(0);
    expect(host(r, 'hero-daily')).toHaveLength(0);
    press(r, 'hero-set-limit');
    expect(n.onSetLimit).toHaveBeenCalled();
  });

  it('no account: asks to set one up and never shows a zero', async () => {
    const { r, n } = await mountHero(homeData({ currency: 'INR', accounts: { hasAccounts: false, inAccountsMinor: null, cardDuesMinor: null } }));
    expect(texts(r)).toContain('Set up an account to calculate your balance');
    expect(texts(r)).not.toContain('In accounts');
    press(r, 'home-add-account');
    expect(n.onAddAccount).toHaveBeenCalled();
  });

  it('a balance not set reads Not set with +1 account not set, never zero', async () => {
    const { r } = await mountHero(homeData({ currency: 'INR', accounts: { inAccountsMinor: null, notSetCount: 1, notSetCards: 1, cardDuesMinor: null } }));
    expect(texts(r)).toEqual(expect.arrayContaining(['Not set', '+1 account not set', '+1 card not set']));
    expect(texts(r).join(' ')).not.toMatch(/₹0\.00/);
  });

  it.each([['under', UNDER], ['over', OVER], ['types', TYPES], ['none', NONE]] as const)('%s: no text carries a minus sign', async (_n, d) => {
    const { r } = await mountHero(d);
    for (const t of texts(r)) expect(t).not.toMatch(/[-−]/);
  });

  it('shows the period chip in the header', async () => {
    const { r } = await mountHero(UNDER);
    expect(texts(r)).toContain('1–30 Nov');
    const shortened = homeData({ currency: 'INR', summary: { period: { start: '2026-11-01', end: '2026-11-24', label: 'x', title: '1–24 Nov · Shortened cycle', shortened: true } } });
    const s = await mountHero(shortened);
    expect(texts(s.r)).toContain('1–24 Nov · Shortened cycle');
  });

  it('draws the brand band in light and the glows in dark', async () => {
    const light = await mountHero(UNDER, 'light');
    expect(host(light.r, 'home-band')).toHaveLength(1);
    expect(host(light.r, 'home-glows')).toHaveLength(0);
    const dark = await mountHero(UNDER, 'dark');
    expect(host(dark.r, 'home-glows')).toHaveLength(1);
    expect(host(dark.r, 'home-band')).toHaveLength(0);
  });

  it('the glows never exceed 45% alpha', () => {
    for (const k of ['glow-start-dark', 'glow-mid-dark', 'glow-end-dark'] as const) expect(parseHex(colorTokens[k]).a).toBeLessThanOrEqual(0.45);
  });
});

describe('hero taps and the eye', () => {
  it('tapping the hero opens the overall budget, the Plan tab, or the editor', async () => {
    const a = await mountHero(UNDER);
    press(a.r, 'hero-main');
    expect(a.n.onOpenBudget).toHaveBeenCalledWith('b1', '2026-11-01');
    const b = await mountHero(TYPES);
    press(b.r, 'hero-main');
    expect(b.n.onOpenPlan).toHaveBeenCalled();
    const c = await mountHero(NONE);
    press(c.r, 'hero-main');
    expect(c.n.onSetLimit).toHaveBeenCalled();
  });

  it('the eye is a 48dp toggle that masks the amounts and reads Hide amounts, toggle', async () => {
    const { r } = await mountHero(UNDER);
    const eye = () => host(r, 'hero-eye')[0]!;
    expect(eye().props).toMatchObject({ accessibilityLabel: 'Hide amounts', accessibilityRole: 'togglebutton', accessibilityState: { checked: false } });
    expect(eye().props.style).toMatchObject({ width: 48, height: 48 });
    press(r, 'hero-eye');
    expect(eye().props.accessibilityState).toMatchObject({ checked: true });
    expect(texts(r).join(' ')).not.toMatch(/11,860/);
    expect(texts(r)).toContain('₹ ••••');
    expect(host(r, 'hero-bar-fill')).toHaveLength(0);
  });

  it('saves the setting, announces politely, and the next tap shows the amounts again', async () => {
    const { r, settings } = await mountHero(UNDER);
    press(r, 'hero-eye');
    expect(settings.setHideAmounts).toHaveBeenLastCalledWith(true);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Amounts hidden');
    press(r, 'hero-eye');
    expect(settings.setHideAmounts).toHaveBeenLastCalledWith(false);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Amounts shown');
    expect(texts(r)).toContain('₹11,860.00');
  });

  it('a failed save is announced, and a rejected save goes back too', async () => {
    const failed = await mountHero(UNDER, 'light', settingsFake(false));
    press(failed.r, 'hero-eye');
    await settle();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Amounts shown');
    const rejecting = settingsFake();
    rejecting.setHideAmounts.mockRejectedValue(new Error('boom'));
    const r = await mountHero(UNDER, 'light', rejecting);
    press(r.r, 'hero-eye');
    await settle();
    expect(useAmountsStore.getState().hidden).toBe(false);
  });

  it('two quick taps with the first save failing leave the last tap standing', async () => {
    const s = settingsFake();
    let rejectFirst!: (e: Error) => void;
    s.setHideAmounts.mockImplementationOnce(() => new Promise((_res, rej) => { rejectFirst = rej; }));
    const { r } = await mountHero(UNDER, 'light', s);
    press(r, 'hero-eye'); // hide
    press(r, 'hero-eye'); // show again
    await act(async () => rejectFirst(new Error('late failure')));
    await settle();
    expect(useAmountsStore.getState().hidden).toBe(false);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenLastCalledWith('Amounts shown');
    expect(texts(r)).toContain('₹11,860.00');
  });

  it('goes back to what it was when the save fails, so the screen never claims what is not stored', async () => {
    const { r } = await mountHero(UNDER, 'light', settingsFake(false));
    press(r, 'hero-eye');
    await settle();
    expect(useAmountsStore.getState().hidden).toBe(false);
    expect(texts(r)).toContain('₹11,860.00');
  });
});

describe('Hide amounts across Home (Story 5.3)', () => {
  it.each([['under', UNDER], ['over', OVER], ['50/30/20 only', TYPES], ['no budget', NONE]] as const)('the %s hero shows and speaks no money, keeps counts and days', async (_n, d) => {
    const { r } = await mountHero(d);
    press(r, 'hero-eye');
    expect(moneyLeaks(r)).toEqual([]);
    expect(host(r, 'hero-bar-fill')).toHaveLength(0);
    expect(host(r, 'hero-bar-track')).toHaveLength(_n === 'no budget' ? 0 : 1); // the track stays under every budget state, never with no budget
  });
  it('keeps the card the same height masked and unmasked: the track stays and nothing moves', async () => {
    const a = await mountHero(UNDER);
    const before = host(a.r, 'hero-bar-track').length;
    press(a.r, 'hero-eye');
    expect(host(a.r, 'hero-bar-track')).toHaveLength(before);
  });
  it('the masked over state keeps its days and the Over budget label', async () => {
    const { r } = await mountHero(OVER);
    press(r, 'hero-eye');
    expect(texts(r)).toEqual(expect.arrayContaining(['Over budget', '5 days to payday', '₹ ••••']));
  });
});

describe('hero TalkBack (UX-DR86)', () => {
  const label = (r: ReactTestRenderer) => host(r, 'hero-main')[0]!.props.accessibilityLabel as string;
  it('is one merged node with the exact label under budget', async () => {
    const { r } = await mountHero(UNDER);
    expect(label(r)).toBe('Left in budget, 11,860 rupees. Spent 8,140 of 20,000. About 988 rupees per day, 12 days to payday. In accounts 52,300 rupees. Card dues 4,100 rupees. Double-tap for budget details');
  });
  it('over budget starts Over budget by and reads the days', async () => {
    const { r } = await mountHero(OVER);
    expect(label(r)).toBe('Over budget by 2,340 rupees. Spent 22,340 of 20,000. 5 days to payday. In accounts 52,300 rupees. Card dues 4,100 rupees. Double-tap for budget details');
  });
  it('masked, the label reads amount hidden everywhere and Sort it names no amount', async () => {
    const { r } = await mountHero(TYPES);
    press(r, 'hero-eye');
    expect(label(r)).toBe('Left in budget, amount hidden. Spent amount hidden of amount hidden. About amount hidden per day, 12 days to payday. In accounts amount hidden. Card dues amount hidden. Double-tap for budget details');
    expect(host(r, 'hero-sort-it')[0]!.props.accessibilityLabel).toBe('Sort amount hidden of unclassified spending');
    useAmountsStore.getState().setHidden(false);
    const o = await mountHero(OVER);
    press(o.r, 'hero-eye');
    expect(label(o.r)).toMatch(/^Over budget, amount hidden./);
    expect(label(o.r)).not.toMatch(/[0-9]{3}/);
  });
  it('Sort it is named with the spoken amount', async () => {
    const { r } = await mountHero(TYPES);
    expect(host(r, 'hero-sort-it')[0]!.props.accessibilityLabel).toBe('Sort 3,000 rupees of unclassified spending');
  });
  it('with no account the setup text is not repeated in the merged node', async () => {
    const { r } = await mountHero(homeData({ currency: 'INR', accounts: { hasAccounts: false, inAccountsMinor: null, cardDuesMinor: null } }));
    expect(label(r)).not.toMatch(/Set up an account/);
    expect(texts(r)).toContain('Set up an account to calculate your balance');
  });
  it('the eye, Set a limit and Sort it are separate 48dp nodes outside the merged one', async () => {
    const t = await mountHero(TYPES);
    expect(host(t.r, 'hero-sort-it')[0]!.props.style).toMatchObject({ minHeight: 48 });
    expect(host(t.r, 'hero-eye')).toHaveLength(1);
    const n = await mountHero(NONE);
    expect(host(n.r, 'hero-set-limit')[0]!.props.style).toMatchObject({ minHeight: 48 });
    expect(host(n.r, 'hero-main')[0]!.props.accessibilityLabel).not.toMatch(/Set a limit/);
  });
});

describe('hero at large text', () => {
  it('stacks In accounts and Card dues, and the amount auto-fits instead of clipping', async () => {
    mockFontScale = 2;
    const big = homeData({ currency: 'INR', accounts: ACCOUNTS, summary: { heroMode: 'overall', leftMinor: 1_186_000_000, usedMinor: 0, targetMinor: 1_186_000_000, overallBudgetId: 'b1' } });
    const { r } = await mountHero(big);
    expect(host(r, 'hero-accounts')[0]!.props.style.flat().some((s: { flexDirection?: string }) => s?.flexDirection === 'column')).toBe(true);
    const amount = host(r, 'hero-amount')[0]!;
    expect(amount.props).toMatchObject({ adjustsFontSizeToFit: true, numberOfLines: 1, maxFontSizeMultiplier: 1.5, ellipsizeMode: 'clip' });
    expect(amount.props.minimumFontScale).toBeCloseTo(28 / 40, 5);
  });
});

describe('homeHeroNav (Story 5.2)', () => {
  const deps = () => ({ navigate: jest.fn(), openActivity: jest.fn(), requestBudgetEditor: jest.fn() });
  it('opens the overall budget, the Plan tab, and Activity with the filter it was given', () => {
    const d = deps();
    const n = homeHeroNav(d);
    n.onOpenBudget('b1');
    expect(d.navigate).toHaveBeenLastCalledWith('BudgetDetail', { budgetId: 'b1' });
    n.onOpenPlan();
    expect(d.navigate).toHaveBeenLastCalledWith('Tabs', { screen: 'Plan' });
    n.onSortIt({ categoryIds: ['c1'], fromDate: '2026-11-01', toDate: '2026-11-30' });
    expect(d.openActivity).toHaveBeenCalledWith({ categoryIds: ['c1'], fromDate: '2026-11-01', toDate: '2026-11-30' });
  });
  it('opens a budget at its period, the review queue, and Activity from a card', () => {
    const d = deps();
    const n = homeHeroNav(d);
    n.onOpenBudget('g', '2026-11-16');
    expect(d.navigate).toHaveBeenLastCalledWith('BudgetDetail', { budgetId: 'g', periodStart: '2026-11-16' });
    n.onOpenReview();
    expect(d.navigate).toHaveBeenLastCalledWith('ReviewQueue', {});
    n.onOpenActivity({ types: ['income'], fromDate: '2026-11-01', toDate: '2026-11-30' });
    expect(d.openActivity).toHaveBeenLastCalledWith({ types: ['income'], fromDate: '2026-11-01', toDate: '2026-11-30' });
  });

  it('opens Edit Home', () => {
    const d = deps();
    homeHeroNav(d).onEditHome();
    expect(d.navigate).toHaveBeenLastCalledWith('HomeEdit');
  });

  it('Set a limit asks for the editor first, then goes to the Plan tab', () => {
    const d = deps();
    homeHeroNav(d).onSetLimit();
    expect(d.requestBudgetEditor).toHaveBeenCalledTimes(1);
    expect(d.navigate).toHaveBeenCalledWith('Tabs', { screen: 'Plan' });
    expect(d.requestBudgetEditor.mock.invocationCallOrder[0]).toBeLessThan(d.navigate.mock.invocationCallOrder[0]!);
  });
});
