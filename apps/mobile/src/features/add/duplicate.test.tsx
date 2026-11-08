import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { groupByDay, type ActivityRow, type DuplicateInfo } from '@wmbugo/core';
import { ActivityScreen } from '../activity/ActivityScreen';
import type { ActivityApi, ActivityData } from '../activity/activityApi';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { cleanup, fire, has, host, mountReady, quietAccessibility, settle, tap, texts } from './testKit';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

afterEach(cleanup);
beforeEach(quietAccessibility);

const info = (over: Partial<DuplicateInfo> = {}): DuplicateInfo => ({
  matchedTransactionId: 'm1',
  heldCategory: { id: 'cat_food', name: 'Food & Drinks' },
  confirmedCategory: { id: 'cat_food', name: 'Food & Drinks' },
  categoriesDiffer: false,
  ...over,
});

async function saveDuplicate(over: Parameters<typeof mountReady>[0] = {}) {
  const m = await mountReady(over);
  m.record.mockResolvedValueOnce({ ok: true, value: { transactionId: 'held1', accountId: 'a1', result: 'POSSIBLE_DUPLICATE' } });
  tap(m.r, '450');
  act(() => fire(m.r, 'category-cat_food'));
  await act(async () => fire(m.r, 'save'));
  await settle();
  return m;
}

describe('possible duplicate on save (Story 3.3)', () => {
  it('the toast reads "Looks like this is already recorded" with Keep both and Merge, and no plain Saved', async () => {
    const { r } = await saveDuplicate();
    expect(texts(r)).toEqual(expect.arrayContaining(['Looks like this is already recorded', 'Keep both', 'Merge']));
    expect(texts(r)).not.toContain('Saved');
  });

  it('Keep both confirms the held entry and offers Kept both with Undo, which undoes it', async () => {
    const { r, keepBoth, undoResolution } = await saveDuplicate();
    await act(async () => fire(r, 'toast-choice-0'));
    await settle();
    expect(keepBoth).toHaveBeenCalledWith('held1');
    expect(texts(r)).toEqual(expect.arrayContaining(['Kept both', 'Undo']));
    await act(async () => fire(r, 'toast-undo'));
    await settle();
    expect(undoResolution).toHaveBeenCalledWith('held1');
  });

  it('Merge with the same category merges at once and offers Merged with Undo', async () => {
    const { r, merge, undoResolution } = await saveDuplicate();
    await act(async () => fire(r, 'toast-choice-1'));
    await settle();
    expect(merge).toHaveBeenCalledWith('held1', undefined);
    expect(texts(r)).toEqual(expect.arrayContaining(['Merged', 'Undo']));
    await act(async () => fire(r, 'toast-undo'));
    await settle();
    expect(undoResolution).toHaveBeenCalledWith('held1');
  });

  it('Merge with different categories asks "Which category?" with both as chips, the confirmed one first, and merges with the choice', async () => {
    const m = await saveDuplicate();
    m.duplicateInfo.mockResolvedValueOnce(info({ categoriesDiffer: true, heldCategory: { id: 'cat_transport', name: 'Transport' }, confirmedCategory: { id: 'cat_food', name: 'Food & Drinks' } }));
    await act(async () => fire(m.r, 'toast-choice-1'));
    await settle();
    expect(m.merge).not.toHaveBeenCalled();
    expect(has(m.r, 'merge-category-sheet')).toBe(true);
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Which category?', 'Food & Drinks', 'Transport']));
    const chips = m.r.root.findAll((n) => typeof n.type === 'string' && /^merge-category-cat_/.test(String(n.props.testID))).map((n) => n.props.testID);
    expect(chips).toEqual(['merge-category-cat_food', 'merge-category-cat_transport']);
    await act(async () => fire(m.r, 'merge-category-cat_transport'));
    await settle();
    expect(m.merge).toHaveBeenCalledWith('held1', 'cat_transport');
  });

  it('a failed answer says so and changes nothing else', async () => {
    const m = await saveDuplicate();
    m.keepBoth.mockResolvedValueOnce({ ok: false });
    await act(async () => fire(m.r, 'toast-choice-0'));
    await settle();
    expect(texts(m.r)).toContain('Could not do that. Nothing was changed.');
  });

  it('a normal save still toasts Saved with Undo', async () => {
    const m = await mountReady();
    tap(m.r, '9');
    act(() => fire(m.r, 'category-cat_food'));
    await act(async () => fire(m.r, 'save'));
    await settle();
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Saved', 'Undo']));
    expect(has(m.r, 'toast-choice-0')).toBe(false);
  });
});

describe('a flagged entry in Activity (durable path)', () => {
  const row = (id: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
    id, kind: 'expense', amountMinor: 45000, localDate: '2026-11-07', merchant: 'Swiggy', categoryName: 'Food & Drinks', categoryIcon: 'ForkKnife', categoryColor: 'cat-rose', accountName: 'DBS', ...over,
  });
  const data = (rows: ActivityRow[]): ActivityData => ({ currency: 'SGD', locale: 'en-SG', today: '2026-11-07', days: groupByDay(rows), hasMore: false });

  async function mountActivity(rows: ActivityRow[]) {
    const f = await mountReady();
    const qc = createQueryClient();
    const api: ActivityApi = { load: async () => data(rows) };
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <QueryClientProvider client={qc}>
          <ThemeProvider>
            <ToastHost bottomOffset={0}>
              <SheetHost>
                <ActivityScreen api={api} duplicateApi={f.api} onAccounts={() => undefined} onProfile={() => undefined} onAdd={() => undefined} />
              </SheetHost>
            </ToastHost>
          </ThemeProvider>
        </QueryClientProvider>,
      );
    });
    await settle();
    return { r, f, qc, unmount: () => act(() => r.unmount()) };
  }

  it('shows "Possible duplicate — check it" with Keep both and Merge, and the day Spent leaves it out', async () => {
    const m = await mountActivity([row('a'), row('held', { held: true })]);
    const t = m.r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
    expect(t).toEqual(expect.arrayContaining(['Food & Drinks · DBS · Possible duplicate — check it', 'Keep both', 'Merge']));
    expect(host(m.r, 'activity-row-held').props.accessibilityLabel).toContain('possible duplicate — check it');
    const day = host(m.r, 'day-2026-11-07').props.accessibilityLabel as string;
    expect(day).toBe('Saturday 7 November, spent 450 Singapore dollars');
    m.unmount();
  });

  it('Keep both and Merge on the row do exactly what the toast does', async () => {
    const m = await mountActivity([row('a'), row('held', { held: true })]);
    await act(async () => fire(m.r, 'keep-both-held'));
    await settle();
    expect(m.f.keepBoth).toHaveBeenCalledWith('held');
    await act(async () => fire(m.r, 'merge-held'));
    await settle();
    expect(m.f.merge).toHaveBeenCalledWith('held', undefined);
    m.unmount();
  });

  it('an ordinary row has no buttons', async () => {
    const m = await mountActivity([row('a')]);
    expect(has(m.r, 'keep-both-a')).toBe(false);
    m.unmount();
  });
});
