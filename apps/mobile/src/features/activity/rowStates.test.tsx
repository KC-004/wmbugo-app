import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ActivityRow } from '@wmbugo/core';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { TabBar } from '../shell/TabBar';
import { ActivityRowView } from './ActivityRowView';
import { useReviewDot, type ReviewApi } from './reviewDot';

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 400, height: 800, scale: 2, fontScale: mockFontScale }),
}));
jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0 } }));

const live: ReactTestRenderer[] = [];
afterEach(() => {
  for (const r of live.splice(0)) act(() => r.unmount());
  mockFontScale = 1;
  jest.restoreAllMocks();
});
beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
});

const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;

const base: ActivityRow = { id: 'x', kind: 'expense', amountMinor: 42000, localDate: '2026-11-07', merchant: 'Swiggy', categoryName: 'Food & Drinks', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: 'HDFC' };

function mountRow(row: ActivityRow) {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <ThemeProvider>
        <ActivityRowView row={row} date="2026-11-07" currency="INR" locale="en-IN" />
      </ThemeProvider>,
    );
  });
  live.push(r);
  return r;
}

/** The 11 row states and what each must read, see, and say to TalkBack. */
const STATES: { name: string; row: ActivityRow; shows: string[]; spoken: string; tags: string[] }[] = [
  { name: 'confirmed expense', row: base, shows: ['Swiggy', '₹420.00'], spoken: 'Swiggy, spent 420 rupees, Food & Drinks, HDFC, Saturday 7 November', tags: [] },
  { name: 'income', row: { ...base, id: 'i', kind: 'income', amountMinor: 8_500_000, merchant: null, categoryName: 'Salary' }, shows: ['Salary', '+₹85,000.00'], spoken: 'Salary, income, plus 85,000 rupees, Salary, HDFC, Saturday 7 November', tags: [] },
  { name: 'refund', row: { ...base, id: 'r', kind: 'refund', amountMinor: 129_900 }, shows: ['+₹1,299.00'], spoken: 'Swiggy, refund, plus 1,299 rupees, Food & Drinks, HDFC, Saturday 7 November', tags: [] },
  { name: 'transfer', row: { ...base, id: 't', kind: 'transfer', amountMinor: 500_000, merchant: null, categoryName: null, accountName: 'HDFC → Cash' }, shows: ['Transfer', '₹5,000.00'], spoken: 'Transfer, transfer 5,000 rupees, HDFC → Cash, Saturday 7 November', tags: [] },
  { name: 'guessed', row: { ...base, id: 'g', guessed: true }, shows: ['guessed'], spoken: 'Swiggy, spent 420 rupees, Food & Drinks, HDFC, guessed, Saturday 7 November', tags: ['guessed'] },
  { name: 'needs a category', row: { ...base, id: 'n', needsCategory: true, categoryName: null }, shows: ['add category'], spoken: 'Swiggy, spent 420 rupees, HDFC, add category, Saturday 7 November', tags: ['add category'] },
  { name: 'waiting', row: { ...base, id: 'w', waiting: true }, shows: ['waiting'], spoken: 'Swiggy, spent 420 rupees, Food & Drinks, HDFC, waiting, Saturday 7 November', tags: ['waiting'] },
  { name: 'waiting for currency', row: { ...base, id: 'c', waiting: true, foreign: { currency: 'USD', amountMinor: 1299 } }, shows: ['currency', '$12.99'], spoken: 'Swiggy, USD 12.99, waiting for currency, Food & Drinks, HDFC, Saturday 7 November', tags: ['currency'] },
  { name: 'possible duplicate', row: { ...base, id: 'd', held: true }, shows: ['Check'], spoken: 'Swiggy, spent 420 rupees, Food & Drinks, HDFC, possible duplicate, check it, Saturday 7 November', tags: ['Check'] },
  { name: 'reversed', row: { ...base, id: 'v', reversed: true }, shows: ['reversed'], spoken: 'Swiggy, spent 420 rupees, Food & Drinks, HDFC, reversed, Saturday 7 November', tags: ['reversed'] },
  { name: 'before tracking started', row: { ...base, id: 'b', beforeTracking: true }, shows: ['before tracking'], spoken: 'Swiggy, spent 420 rupees, Food & Drinks, HDFC, before tracking started, Saturday 7 November', tags: ['before tracking'] },
];

describe('Activity rows in every state (UX-DR29, UX-DR30, UX-DR82)', () => {
  it.each(STATES.flatMap((s) => [[s.name, 1, s] as const, [s.name, 2, s] as const]))('%s at font scale %i', (_name, scale, s) => {
    mockFontScale = scale;
    const r = mountRow(s.row);
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(s.shows));
    expect(t.join(' ')).not.toMatch(/[-−–]\s?[₹$]|[-−–]\d/); // never a minus sign
    expect(host(r, `activity-row-${s.row.id}`).props.accessibilityLabel).toBe(s.spoken);
    const tags = r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === `tags-${s.row.id}`);
    if (s.tags.length === 0) expect(tags).toHaveLength(0);
    else {
      const pills = tags[0]!.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().join(''));
      expect(pills).toEqual(s.tags);
      // tags are decorative: not separately focusable
      expect(tags[0]!.props.importantForAccessibility).toBe('no-hide-descendants');
    }
  });

  it('waiting rows have a dashed outline, a reversed row is struck through, a refund has a decorative return icon, a Check row a hint', () => {
    const flat = (n: { props: { style?: unknown } }) => ([] as Record<string, unknown>[]).concat(n.props.style as never).flat(5).filter(Boolean) as Record<string, unknown>[];
    const w = host(mountRow({ ...base, id: 'w2', waiting: true }), 'activity-row-w2');
    expect(flat(w).some((s) => s.borderStyle === 'dashed' && s.borderRadius === 4)).toBe(true);
    const v = mountRow({ ...base, id: 'v2', reversed: true });
    const struck = v.root.findAll((n) => n.type === Text && flat(n).some((s) => s.textDecorationLine === 'line-through'));
    expect(struck.length).toBeGreaterThanOrEqual(2); // title and amount
    const refund = mountRow({ ...base, id: 'r2', kind: 'refund', amountMinor: 129_900 });
    expect(refund.root.findAll((n) => typeof n.type === 'string' && n.props.importantForAccessibility === 'no' && n.props.accessibilityElementsHidden === true)).toHaveLength(1);
    expect(host(mountRow({ ...base, id: 'd2', held: true }), 'activity-row-d2').props.accessibilityHint).toBe('Double-tap to review possible duplicate');
    expect(host(mountRow({ ...base, id: 'p2' }), 'activity-row-p2').props.accessibilityHint).toBeUndefined();
  });

  it('tags are pills: rounded, 2 by 8dp, bg-canvas fill with a hairline border', () => {
    const r = mountRow({ ...base, id: 'g2', guessed: true });
    const merge = (n: { props: { style?: unknown } }) => ([] as Record<string, unknown>[]).concat(n.props.style as never).flat(5).filter(Boolean).reduce((a, b) => ({ ...a, ...b }), {} as Record<string, unknown>);
    const pill = host(r, 'tags-g2').findAll((n) => typeof n.type === 'string' && merge(n).paddingVertical === 2)[0]!;
    expect(merge(pill)).toMatchObject({ borderWidth: 1, paddingVertical: 2, paddingHorizontal: 8 });
    expect(Number(merge(pill).borderRadius)).toBeGreaterThanOrEqual(999);
  });
});

describe('the Activity tab dot', () => {
  const props = (reviewDot: boolean) => ({
    state: { index: 1, routes: [{ key: 'h', name: 'Home' }, { key: 'a', name: 'Activity' }, { key: 'i', name: 'Insights' }, { key: 'p', name: 'Plan' }] },
    navigation: { emit: () => ({ defaultPrevented: false }), navigate: () => undefined },
    onAdd: () => undefined,
    reviewDot,
  });
  const mountBar = (dot: boolean) => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <ThemeProvider>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <TabBar {...(props(dot) as any)} />
        </ThemeProvider>,
      );
    });
    live.push(r);
    return r;
  };

  it('shows a small dot with no count and the TalkBack label "Activity, entries to check" while entries wait', () => {
    const r = mountBar(true);
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'review-dot')).toHaveLength(1);
    expect(host(r, 'tab-Activity').props.accessibilityLabel).toBe('Activity, entries to check');
    expect(texts(r).join('')).not.toMatch(/\d/);
  });

  it('has no dot when nothing waits', () => {
    const r = mountBar(false);
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'review-dot')).toHaveLength(0);
    expect(host(r, 'tab-Activity').props.accessibilityLabel).toBe('Activity');
  });

  it('useReviewDot follows the count and drops away when none remain', async () => {
    let count = 2;
    const api: ReviewApi = { count: async () => count };
    const qc = createQueryClient();
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useReviewDot(api));
      return null;
    }
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={qc}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    live.push(r);
    await act(async () => new Promise((res) => setTimeout(res, 0)));
    expect(seen[seen.length - 1]).toBe(true);
    count = 0;
    await act(async () => qc.invalidateQueries({ queryKey: ['ledger'] }));
    await act(async () => new Promise((res) => setTimeout(res, 0)));
    expect(seen[seen.length - 1]).toBe(false);
    qc.clear();
  });
});
