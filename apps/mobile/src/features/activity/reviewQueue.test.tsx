import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReviewItem, ReviewSide, TxSnapshot } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { ReviewQueueScreen } from './ReviewQueueScreen';
import type { ReviewApi, ReviewData } from './reviewApi';

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
const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
const press = async (r: ReactTestRenderer, id: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress());
  await settle();
};
const change = async (r: ReactTestRenderer, id: string, v: string) => {
  await act(async () => r.root.findAll((n) => n.props.testID === id && typeof n.props.onChangeText === 'function')[0]!.props.onChangeText(v));
  await settle();
};

const side = (id: string, over: Partial<ReviewSide> = {}): ReviewSide => ({
  id, amountMinor: 45_000, localDate: '2026-11-08', occurredAtMs: Date.UTC(2026, 10, 8, 15, 42), merchant: 'SWIGGY*BLR 8821', account: 'HDFC', category: 'Food & Drinks', sourceKind: 'sms', ...over,
});
const item = (id: string, over: Partial<ReviewItem> = {}): ReviewItem => ({ ...side(id), eventType: 'expense', reason: 'pending', alreadyRecorded: null, foreign: null, ...over });

function dataOf(items: ReviewItem[], needsCategory: ReviewSide[] = []): ReviewData {
  return {
    currency: 'INR', exponent: 2, locale: 'en-IN', items, needsCategory,
    accounts: [{ id: 'a1', name: 'HDFC' }, { id: 'a2', name: 'Cash' }],
    categories: [
      { id: 'cat_food', name: 'Food & Drinks', kind: 'expense' },
      { id: 'cat_transport', name: 'Transport', kind: 'expense' },
      { id: 'cat_uncategorised', name: 'Uncategorised', kind: 'expense' },
    ],
  };
}

async function mountQueue(first: ReviewData, over: Partial<ReviewApi> = {}, focusId?: string) {
  const state = { data: first };
  const snapshot = { id: 'x' } as TxSnapshot;
  const approve = jest.fn(async (id: string) => {
    state.data = dataOf(state.data.items.filter((i) => i.id !== id), state.data.needsCategory);
    return { ok: true as const, value: { snapshot } };
  });
  const confirmForeign = jest.fn(async (id: string) => {
    state.data = dataOf(state.data.items.filter((i) => i.id !== id), state.data.needsCategory);
    return { ok: true as const, value: { snapshot } };
  });
  const undoDecision = jest.fn(async () => ({ ok: true }));
  const remove = jest.fn(async () => ({ ok: true as const, value: { snapshot } }));
  const assignCategory = jest.fn(async (id: string) => {
    state.data = dataOf(state.data.items, state.data.needsCategory.filter((e) => e.id !== id));
    return { ok: true as const, value: { previous: [{ id, categoryId: 'cat_uncategorised' }] } };
  });
  const api: ReviewApi = { load: async () => state.data, approve, confirmForeign, undoDecision, remove, restore: async () => ({ ok: true }), assignCategory, undoCategory: async () => ({ ok: true }), ...over };
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <ReviewQueueScreen
                focusId={focusId}
                api={api}
                onBack={() => undefined}
                onEdit={() => undefined}
                duplicateApi={{ duplicateInfo: async () => null, keepBoth: async () => ({ ok: true }), merge: async () => ({ ok: true }), undoResolution: async () => ({ ok: true }) }}
              />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, qc, approve, confirmForeign, undoDecision, remove, assignCategory };
}

describe('review queue screen (Story 3.10)', () => {
  it('opens under "2 to check" listing the waiting entries', async () => {
    const m = await mountQueue(dataOf([item('p1'), item('p2', { merchant: 'Uber' })]));
    expect(texts(m.r)).toContain('2 to check');
    expect(has(m.r, 'review-item-p1') && has(m.r, 'review-item-p2')).toBe(true);
  });

  it('a possible duplicate shows This entry and Already recorded side by side with Keep both, Merge and Delete / Reject', async () => {
    const orig = side('o', { sourceKind: 'manual', merchant: 'Swiggy' });
    const m = await mountQueue(dataOf([item('d1', { reason: 'duplicate', alreadyRecorded: orig })]));
    const t = texts(m.r);
    expect(t).toEqual(expect.arrayContaining(['This entry', 'Already recorded', 'Bank SMS', 'Added by you', 'Keep both', 'Merge', 'Reject · Not mine']));
    const manual = await mountQueue(dataOf([item('d2', { reason: 'duplicate', alreadyRecorded: orig, sourceKind: 'manual' })]));
    expect(texts(manual.r)).toContain('Delete');
  });

  it('a pending capture offers Approve, Edit and Reject · Not mine; Approve toasts with Undo and the list updates', async () => {
    const m = await mountQueue(dataOf([item('p1'), item('p2')]));
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Approve', 'Edit', 'Reject · Not mine']));
    await press(m.r, 'review-approve-p1');
    expect(m.approve).toHaveBeenCalledWith('p1');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Approved', 'Undo', '1 to check']));
    await press(m.r, 'toast-undo');
    expect(m.undoDecision).toHaveBeenCalled();
  });

  it('a foreign-currency item shows USD 12.99, keeps Confirm disabled with the hint until an amount is typed, and confirms in ₹', async () => {
    const fx = item('fx', { foreign: { amountMinor: 1299, currency: 'USD', exponent: 2 }, amountMinor: 0 });
    const m = await mountQueue(dataOf([fx]));
    expect(texts(m.r)).toEqual(expect.arrayContaining(['USD 12.99', 'Amount charged in ₹']));
    const confirm = () => m.r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'review-confirm-fx')[0]!;
    expect(JSON.stringify(confirm().props.accessibilityHint ?? '')).toContain('Enter the amount in ₹ to confirm');
    await press(m.r, 'review-confirm-fx');
    expect(m.confirmForeign).not.toHaveBeenCalled();
    await change(m.r, 'review-amount-fx', '1080');
    await press(m.r, 'review-confirm-fx');
    expect(m.confirmForeign).toHaveBeenCalledWith('fx', 108_000, 'a1');
  });

  it('entries needing a category are their own section below, not counted; choosing a category clears the row', async () => {
    const m = await mountQueue(dataOf([item('p1')], [side('c1', { category: null, merchant: 'Corner shop', sourceKind: 'manual' })]));
    expect(texts(m.r)).toEqual(expect.arrayContaining(['1 to check', 'Add a category', 'Corner shop']));
    await press(m.r, 'review-cat-c1-cat_transport');
    expect(m.assignCategory).toHaveBeenCalledWith('c1', 'cat_transport');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Category added', 'Undo']));
    expect(has(m.r, 'review-cat-c1')).toBe(false);
  });

  it('resolving the last item shows All checked; an empty queue shows the boat and "You\'re all caught up · Smooth sailing"', async () => {
    const m = await mountQueue(dataOf([item('p1')]));
    await press(m.r, 'review-approve-p1');
    expect(has(m.r, 'review-all-checked')).toBe(true);
    expect(texts(m.r)).toContain('All checked');
    const empty = await mountQueue(dataOf([]));
    expect(has(empty.r, 'review-empty')).toBe(true);
    expect(texts(empty.r)).toContain("You're all caught up · Smooth sailing");
  });

  it('a foreign charge is posted to the account the person picks, not the first one', async () => {
    const fx = item('fx2', { foreign: { amountMinor: 500, currency: 'USD', exponent: 2 }, amountMinor: 0 });
    const m = await mountQueue(dataOf([fx]));
    await change(m.r, 'review-amount-fx2', '41');
    await press(m.r, 'review-account-fx2-a2');
    await press(m.r, 'review-confirm-fx2');
    expect(m.confirmForeign).toHaveBeenCalledWith('fx2', 4100, 'a2');
  });
});
