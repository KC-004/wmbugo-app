import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GoalAllocationRow, GoalRow, SaveGoalInput } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { GoalCard, goalFill, paceLine } from './GoalCard';
import { TransactionGoalSection } from './TransactionGoalSection';
import { GoalDetailScreen } from './GoalDetailScreen';
import { GoalsScreen } from './GoalsScreen';
import type { AllocationOutcome, GoalDetailData, GoalOutcome, GoalsApi, GoalsData, TransferGoalState } from './goalsApi';

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
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockImplementation(async (ms: number) => ms);
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const type = async (r: ReactTestRenderer, id: string, text: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(text));
  await settle();
};
const mountNode = async (node: React.ReactElement) => {
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

const goal = (over: Partial<GoalRow> = {}): GoalRow => ({
  id: 'g1', name: 'Goa trip', targetMinor: 3_000_000, dueDate: '2027-03-01', icon: 'Airplane', color: 'cat-cyan', accountId: null, accountName: null, state: 'active',
  setAsideMinor: 0, movedMinor: 0, contributedMinor: 0, remainingMinor: 3_000_000, funded: false, accountIsPot: false, progress: null, ...over,
});
const withMoney = (g: GoalRow, setAside: number, moved = 0): GoalRow => ({ ...g, setAsideMinor: setAside, movedMinor: moved, contributedMinor: setAside + moved, remainingMinor: Math.max(0, g.targetMinor - setAside - moved), funded: setAside + moved >= g.targetMinor });

const data = (goals: GoalRow[] = []): GoalsData => ({ goals, currency: 'INR', locale: 'en-IN', exponent: 2, accounts: [{ id: 'a1', name: 'SIP', isPot: true }], thisMonth: '2026-11' });
const detail = (g: GoalRow, allocations: GoalAllocationRow[] = []): GoalDetailData => ({ detail: { goal: g, allocations }, currency: 'INR', locale: 'en-IN', exponent: 2, accounts: [{ id: 'a1', name: 'SIP', isPot: true }], thisMonth: '2026-11' });

const fakeApi = (d: GoalsData, det?: GoalDetailData | 'missing') => {
  const ok: GoalOutcome = { ok: true };
  const alloc: AllocationOutcome = { ok: true, value: { allocationId: 'al1' } };
  const api = {
    load: jest.fn(async () => d),
    loadDetail: jest.fn(async () => det ?? 'missing'),
    save: jest.fn(async (input: SaveGoalInput) => ({ input, ok: true as const, value: { goalId: 'new1', created: true } })),
    undoAdd: jest.fn(async () => ok),
    setAside: jest.fn(async (): Promise<AllocationOutcome> => alloc),
    takeBack: jest.fn(async (): Promise<AllocationOutcome> => alloc),
    undoAllocation: jest.fn(async () => ok),
    changeState: jest.fn(async () => ok),
    forTransfer: jest.fn(async (): Promise<TransferGoalState> => ({ goal: null, canCount: false, goals: [] })),
    countToward: jest.fn(async () => ok),
    removeTag: jest.fn(async () => ok),
  };
  return api as typeof api & GoalsApi;
};

describe('GoalCard (Story 6.6)', () => {
  it('fill never overflows', () => {
    expect(goalFill(goal())).toBe(0);
    expect(goalFill(withMoney(goal(), 500_000))).toBeCloseTo(1 / 6);
    expect(goalFill(withMoney(goal(), 9_000_000))).toBe(1);
  });

  it('reads the amount of the target and what is left by when', async () => {
    const r = await mountNode(<GoalCard goal={withMoney(goal(), 500_000)} currency="INR" locale="en-IN" onPress={() => undefined} />);
    expect(texts(r).some((t) => /^₹5,000(\.00)? of ₹30,000(\.00)?$/.test(t))).toBe(true);
    expect(texts(r).some((t) => /^₹25,000(\.00)? to go · by Mar 2027$/.test(t))).toBe(true);
    expect(texts(r).some((t) => /^₹5,000(\.00)? set aside$/.test(t))).toBe(true);
    expect(has(r, 'goal-bar-g1')).toBe(true);
  });

  it('hidden amounts: no bar, masked amounts and one spoken node without numbers', async () => {
    const { useAmountsStore } = jest.requireActual('../../shared/state/amountsHidden') as typeof import('../../shared/state/amountsHidden');
    act(() => useAmountsStore.setState({ hidden: true } as never));
    try {
      const r = await mountNode(<GoalCard goal={withMoney(goal(), 500_000)} currency="INR" locale="en-IN" onPress={() => undefined} />);
      expect(has(r, 'goal-bar-g1')).toBe(false);
      expect(texts(r).join(' ')).not.toMatch(/5,000|30,000|25,000/);
      expect(r.root.findAll((n) => n.props.testID === 'goal-card-g1')[0]!.props.accessibilityLabel).toBe('Goa trip, amount hidden');
    } finally {
      act(() => useAmountsStore.setState({ hidden: false } as never));
    }
  });

  it('a funded goal shows the boat moment, no exclamation mark, and Mark complete', async () => {
    const done = jest.fn();
    const r = await mountNode(<GoalCard goal={withMoney(goal(), 3_000_000)} currency="INR" locale="en-IN" onPress={() => undefined} onComplete={done} />);
    expect(texts(r)).toContain('Goa trip is fully funded');
    expect(texts(r).join(' ')).not.toContain('!');
    await press(r, 'goal-complete-g1');
    expect(done).toHaveBeenCalled();
  });
});

describe('Goals (Story 6.6)', () => {
  it('with no goals shows the empty state; an incomplete goal is refused with errors and nothing written', async () => {
    const api = fakeApi(data());
    const r = await mountNode(<GoalsScreen api={api} onBack={() => undefined} onOpenGoal={() => undefined} />);
    expect(texts(r)).toContain('No goals yet. Saving for something?');
    await press(r, 'empty-state-action');
    await press(r, 'goal-save');
    expect(texts(r)).toContain('Error: name required');
    await type(r, 'goal-name', 'Goa trip');
    await press(r, 'goal-save');
    expect(texts(r)).toContain('Error: amount required');
    await type(r, 'goal-amount', '30000');
    await type(r, 'goal-by', '2026-10');
    await press(r, 'goal-save');
    expect(texts(r)).toContain('Error: pick a date from this month on');
    expect(api.save).not.toHaveBeenCalled();
  });

  it('saves Goa trip, 30,000, by March 2027 with the default icon and colour, and offers Undo', async () => {
    const api = fakeApi(data());
    const r = await mountNode(<GoalsScreen api={api} onBack={() => undefined} onOpenGoal={() => undefined} />);
    await press(r, 'empty-state-action');
    await type(r, 'goal-name', 'Goa trip');
    await type(r, 'goal-amount', '30000');
    await type(r, 'goal-by', '2027-03');
    await press(r, 'goal-colour-cat-rose');
    await press(r, 'goal-account-a1');
    await press(r, 'goal-save');
    expect(api.save).toHaveBeenCalledWith({ name: 'Goa trip', targetMinor: 3_000_000, dueMonth: '2027-03', icon: 'PiggyBank', color: 'cat-rose', accountId: 'a1' });
    expect(texts(r)).toContain('Goal added');
    await press(r, 'toast-undo');
    expect(api.undoAdd).toHaveBeenCalledWith('new1');
  });

  it('lists active goals, with Done and Archived collapsed, and opens one', async () => {
    const opened: string[] = [];
    const api = fakeApi(data([goal(), goal({ id: 'g2', name: 'Old', state: 'completed' }), goal({ id: 'g3', name: 'Dusty', state: 'archived' })]));
    const r = await mountNode(<GoalsScreen api={api} onBack={() => undefined} onOpenGoal={(id) => opened.push(id)} />);
    expect(has(r, 'goal-card-g1')).toBe(true);
    expect(has(r, 'goal-card-g2')).toBe(false);
    expect(texts(r)).toEqual(expect.arrayContaining(['Done (1)', 'Archived (1)']));
    await press(r, 'goals-toggle-done');
    expect(has(r, 'goal-card-g2')).toBe(true);
    await press(r, 'goal-card-g1');
    expect(opened).toEqual(['g1']);
  });
});

describe('Goal detail (Story 6.6)', () => {
  const hist: GoalAllocationRow[] = [
    { id: 'm1', kind: 'moved', amountMinor: 200_000, transactionId: 't1', localDate: '2026-11-08', createdAt: 3 },
    { id: 't1', kind: 'taken_back', amountMinor: 200_000, transactionId: null, localDate: '2026-11-09', createdAt: 2 },
    { id: 's1', kind: 'set_aside', amountMinor: 500_000, transactionId: null, localDate: '2026-11-08', createdAt: 1 },
  ];

  it('the history tells Set aside from Moved to savings and a take back has no minus sign', async () => {
    const r = await mountNode(<GoalDetailScreen goalId="g1" api={fakeApi(data(), detail(withMoney(goal(), 300_000, 200_000), hist))} onBack={() => undefined} />);
    const t = texts(r);
    expect(t.some((x) => /^Set aside ₹5,000(\.00)? · 8 Nov$/.test(x))).toBe(true);
    expect(t.some((x) => /^Taken back ₹2,000(\.00)? · 9 Nov$/.test(x))).toBe(true);
    expect(t.some((x) => /^Moved to savings ₹2,000(\.00)? · 8 Nov$/.test(x))).toBe(true);
    expect(t.join(' ')).not.toContain('−');
    expect(t.join(' ')).not.toContain('-₹');
    expect(texts(r).filter((x) => x === 'Moved')).toHaveLength(1);
  });

  it('Set aside confirms the nothing-moves caption, writes once and offers Undo; an empty amount is refused', async () => {
    const api = fakeApi(data(), detail(goal()));
    const r = await mountNode(<GoalDetailScreen goalId="g1" api={api} onBack={() => undefined} />);
    await press(r, 'goal-detail-set-aside');
    expect(texts(r)).toContain('The money stays in your account. It just stops counting as free to use.');
    await press(r, 'goal-amount-confirm');
    expect(texts(r)).toContain('Error: amount required');
    expect(api.setAside).not.toHaveBeenCalled();
    await type(r, 'goal-amount-input', '5000');
    await press(r, 'goal-amount-confirm');
    expect(api.setAside).toHaveBeenCalledWith('g1', 500_000);
    expect(texts(r).some((x) => /^₹5,000(\.00)? set aside for Goa trip$/.test(x))).toBe(true);
    await press(r, 'toast-undo');
    expect(api.undoAllocation).toHaveBeenCalledWith('al1');
  });

  it('Take back more than is set aside says only how much is set aside, and keeps the input', async () => {
    const api = fakeApi(data(), detail(withMoney(goal(), 500_000)));
    api.takeBack.mockResolvedValueOnce({ ok: false, code: 'EXCEEDS_SET_ASIDE:500000' });
    const r = await mountNode(<GoalDetailScreen goalId="g1" api={api} onBack={() => undefined} />);
    await press(r, 'goal-detail-take-back');
    await type(r, 'goal-amount-input', '9000');
    await press(r, 'goal-amount-confirm');
    expect(texts(r).some((x) => /^Error: only ₹5,000(\.00)? is set aside$/.test(x))).toBe(true);
    expect(has(r, 'goal-amount-sheet')).toBe(true);
  });

  it('complete confirms with the set-aside amount, pause and archive change the state, and restore brings it back', async () => {
    const api = fakeApi(data(), detail(withMoney(goal(), 500_000)));
    const r = await mountNode(<GoalDetailScreen goalId="g1" api={api} onBack={() => undefined} />);
    await press(r, 'goal-detail-pause');
    expect(api.changeState).toHaveBeenLastCalledWith('g1', 'paused');
    await press(r, 'goal-detail-complete');
    expect(texts(r).some((x) => /^Complete Goa trip\? The ₹5,000(\.00)? set aside will count as free to use again\.$/.test(x))).toBe(true);
    await press(r, 'goal-complete-confirm');
    expect(api.changeState).toHaveBeenLastCalledWith('g1', 'completed');
    await press(r, 'goal-detail-archive');
    await press(r, 'goal-archive-confirm');
    expect(api.changeState).toHaveBeenLastCalledWith('g1', 'archived');
    const done = await mountNode(<GoalDetailScreen goalId="g1" api={fakeApi(data(), detail(goal({ state: 'archived' })))} onBack={() => undefined} />);
    expect(has(done, 'goal-detail-restore')).toBe(true);
    expect(has(done, 'goal-detail-set-aside')).toBe(false);
    await press(done, 'goal-detail-restore');
  });

  it('a paused goal offers Resume and no Set aside; a deleted goal shows the way back', async () => {
    const r = await mountNode(<GoalDetailScreen goalId="g1" api={fakeApi(data(), detail(goal({ state: 'paused' })))} onBack={() => undefined} />);
    expect(has(r, 'goal-detail-resume')).toBe(true);
    expect(has(r, 'goal-detail-set-aside')).toBe(false);
    const gone = await mountNode(<GoalDetailScreen goalId="g1" api={fakeApi(data())} onBack={() => undefined} />);
    expect(texts(gone)).toContain('This goal was deleted.');
  });
});

describe('Pace and moves (Story 6.7)', () => {
  const money = (n: number) => `₹${n / 100}`;
  const pace = { monthlyMinor: 500_000, projectedMonth: '2027-03' };
  const withPace = (over: Partial<GoalRow> = {}) => goal({ progress: { contributedMinor: 1_000_000, remainingMinor: 2_000_000, pace }, ...over });

  it('reads an honest line: no history, a pace, on track, at this pace, a passed date', () => {
    expect(paceLine(goal(), '2026-11', money)).toBe('Not enough history for a pace yet');
    expect(paceLine(withPace({ dueDate: null }), '2026-11', money)).toBe('About ₹5000 a month · done by Mar 2027');
    expect(paceLine(withPace({ dueDate: '2027-03-01' }), '2026-11', money)).toBe('On track for Mar 2027');
    expect(paceLine(withPace({ dueDate: '2027-02-01' }), '2026-11', money)).toBe('At this pace, done by Mar 2027');
    expect(paceLine(withPace({ dueDate: '2026-10-01', remainingMinor: 2_000_000 }), '2026-11', money)).toBe('Your date has passed · ₹20000 to go');
    expect(paceLine(withPace({ state: 'paused' }), '2026-11', money)).toBeNull();
    expect(paceLine(withMoney(goal(), 3_000_000), '2026-11', money)).toBeNull();
  });

  it('the card shows the pace line and never alarm wording or an exclamation mark', async () => {
    const r = await mountNode(<GoalCard goal={withPace({ dueDate: '2027-02-01' })} currency="INR" locale="en-IN" thisMonth="2026-11" onPress={() => undefined} />);
    expect(texts(r)).toContain('At this pace, done by Mar 2027');
    expect(texts(r).join(' ')).not.toMatch(/!|behind|late|overdue/i);
  });

  const freeOk = { gate: 'ok' as const, valueMinor: 2_400_000, shortByMinor: 0, smaller: 'accounts' as const, leavesMinor: 2_400_000, leftMinor: 6_000_000, leftBudgetId: 'b1', notClassifiedMinor: 0, assetsMinor: 4_200_000, notSetAccounts: 0, billsReservedMinor: 1_800_000, billsCount: 1, setAsideMinor: 0 };

  it('Free to use: setting aside more than is free warns politely and still saves', async () => {
    const api = fakeApi(data(), detail(goal()));
    api.freeToUse = jest.fn(async () => freeOk);
    const r = await mountNode(<GoalDetailScreen goalId="g1" api={api} onBack={() => undefined} />);
    await press(r, 'goal-detail-set-aside');
    await type(r, 'goal-amount-input', '20000');
    expect(has(r, 'goal-amount-note')).toBe(false);
    await type(r, 'goal-amount-input', '29000');
    expect(texts(r).some((t) => /^This leaves you short by ₹5,000(\.00)?$/.test(t))).toBe(true);
    expect(r.root.findAll((n) => n.props.testID === 'goal-amount-note')[0]!.props.accessibilityLiveRegion).toBe('polite');
    await press(r, 'goal-amount-confirm');
    expect(api.setAside).toHaveBeenCalledWith('g1', 2_900_000);
  });

  it('Free to use: with the gate failing there is no warning', async () => {
    const api = fakeApi(data(), detail(goal()));
    api.freeToUse = jest.fn(async () => ({ gate: 'needs_limit' as const }));
    const r = await mountNode(<GoalDetailScreen goalId="g1" api={api} onBack={() => undefined} />);
    await press(r, 'goal-detail-set-aside');
    await type(r, 'goal-amount-input', '99999');
    expect(has(r, 'goal-amount-note')).toBe(false);
  });

  it('Free to use: restoring an archived goal that holds money warns when it would leave you short', async () => {
    const api = fakeApi(data(), detail(withMoney(goal({ state: 'archived' }), 3_000_000)));
    api.freeToUse = jest.fn(async () => freeOk);
    const r = await mountNode(<GoalDetailScreen goalId="g1" api={api} onBack={() => undefined} />);
    await press(r, 'goal-detail-restore');
    expect(api.changeState).toHaveBeenCalledWith('g1', 'active');
    expect(texts(r).some((t) => /This leaves you short by ₹6,000(\.00)?$/.test(t))).toBe(true);
  });

  it('Move to savings hands the goal and its pot to the Add sheet; with no pot it says to add one first', async () => {
    const onMove = jest.fn();
    const r = await mountNode(<GoalDetailScreen goalId="g1" api={fakeApi(data(), detail(goal()))} onBack={() => undefined} onMove={onMove} onAddPot={() => undefined} />);
    await press(r, 'goal-detail-move');
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }), 'a1');
    expect(has(r, 'goal-detail-add-pot')).toBe(false);
    const noPot = { ...detail(goal()), accounts: [{ id: 'b1', name: 'HDFC', isPot: false }] };
    const onAddPot = jest.fn();
    const r2 = await mountNode(<GoalDetailScreen goalId="g1" api={fakeApi(data(), noPot)} onBack={() => undefined} onMove={onMove} onAddPot={onAddPot} />);
    expect(texts(r2)).toContain('Add a savings pot first');
    expect(has(r2, 'goal-detail-move')).toBe(false);
    await press(r2, 'goal-detail-add-pot');
    expect(onAddPot).toHaveBeenCalled();
  });

  it('a savings transfer offers Count toward a goal and tags it once; a tagged one reads For Goa trip with Remove', async () => {
    const api = fakeApi(data());
    api.forTransfer.mockResolvedValue({ goal: null, canCount: true, goals: [{ id: 'g1', name: 'Goa trip' }, { id: 'g2', name: 'Bike' }] });
    const r = await mountNode(<TransactionGoalSection transactionId="t1" api={api} />);
    await press(r, 'transfer-goal-count');
    await press(r, 'transfer-goal-pick-g1');
    expect(api.countToward).toHaveBeenCalledWith('t1', 'g1');
    expect(texts(r)).toContain('Counted toward Goa trip');
    const tagged = fakeApi(data());
    tagged.forTransfer.mockResolvedValue({ goal: { goalId: 'g1', name: 'Goa trip' }, canCount: false, goals: [] });
    const r2 = await mountNode(<TransactionGoalSection transactionId="t1" api={tagged} />);
    expect(texts(r2)).toContain('For Goa trip');
    expect(has(r2, 'transfer-goal-count')).toBe(false);
    await press(r2, 'transfer-goal-remove');
    expect(tagged.removeTag).toHaveBeenCalledWith('t1');
    expect(texts(r2)).toContain('Removed from Goa trip');
  });

  it('shows nothing for a transfer that cannot count toward a goal or when no goal is active', async () => {
    const r = await mountNode(<TransactionGoalSection transactionId="t1" api={fakeApi(data())} />);
    expect(has(r, 'transfer-goal-offer')).toBe(false);
    const api = fakeApi(data());
    api.forTransfer.mockResolvedValue({ goal: null, canCount: true, goals: [] });
    const r2 = await mountNode(<TransactionGoalSection transactionId="t1" api={api} />);
    expect(has(r2, 'transfer-goal-offer')).toBe(false);
  });
});
