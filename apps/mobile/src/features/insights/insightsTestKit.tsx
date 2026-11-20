import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { resolveInsightsPeriod, type InsightsPeriod, type PeriodPreset, type PeriodProfile } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { useAmountsStore } from '../../shared/state/amountsHidden';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import type { InsightsApi, InsightsOverview, InsightsSelection } from './insightsApi';
import { useInsightsStore } from './insightsStore';
import { clearInsightsSections } from './sectionRegistry';

/** Shared helpers for the Insights section tests: mounting under the providers, reading text, pressing by test id, and a fake api. */

const live: ReactTestRenderer[] = [];

/** Call once at the top of a test file: cleans up what each test mounted and silences the accessibility services. */
export function installInsightsHooks(): void {
  afterEach(async () => {
    await act(async () => new Promise((res) => setTimeout(res, 0)));
    for (const r of live.splice(0)) act(() => r.unmount());
    jest.restoreAllMocks();
    useAmountsStore.getState().setHidden(false);
    useInsightsStore.getState().reset();
    clearInsightsSections();
  });
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
    jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockImplementation(async (ms: number) => ms);
  });
}

export const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
export const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
export const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
export const label = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]?.props.accessibilityLabel as string | undefined;
export const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
export const mountNode = async (node: React.ReactElement) => {
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>{node}</SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return r;
};

export const profile: PeriodProfile = { rule: { kind: 'first' }, firstDay: 'mon' };
export const period = (preset: PeriodPreset = 'this_cycle', today = '2026-11-08'): InsightsPeriod => resolveInsightsPeriod(preset, today, profile)!;

export const overview = (over: Partial<InsightsOverview> = {}): InsightsOverview => {
  const p = over.period ?? period();
  const echo = { start: p.start, end: p.end, endExclusive: '2026-12-01', label: p.title, filters: {} };
  return {
    currency: 'INR',
    locale: 'en-IN',
    today: '2026-11-08',
    firstDay: '2026-10-01',
    period: p,
    preset: p.preset,
    presets: ['this_cycle', 'last_cycle', 'today', 'yesterday', 'seven_days', 'this_month', 'last_month', 'this_quarter', 'this_year', 'custom'],
    scope: { period: p, filters: {} },
    scopeParts: [],
    filterChips: [],
    spent: { scope: echo, spentMinor: 300_000, backMinor: 0 },
    income: { scope: echo, incomeMinor: 8_500_000 },
    change: { kind: 'change', scope: echo, direction: 'up', percent: 12, baselineLabel: 'Oct 1–8', previousMinor: 1_250_000 },
    kept: { kind: 'kept', scope: echo, incomeMinor: 8_500_000, spentMinor: 300_000, keptPercent: 96, keptMinor: 8_200_000 },
    waiting: 0,
    entries: 23,
    ...over,
  };
};

/** A fake api: each loader returns what the test gives it (or null / throws for 'error'). */
export function fakeInsightsApi(parts: Partial<InsightsApi> = {}): InsightsApi {
  return {
    loadOverview: jest.fn(async (_s: InsightsSelection) => overview()),
    loadFacets: jest.fn(async () => ({ accounts: [], categories: [], merchants: [], tags: [], sources: [] })),
    loadCategories: jest.fn(async () => null),
    ...parts,
  } as InsightsApi;
}
