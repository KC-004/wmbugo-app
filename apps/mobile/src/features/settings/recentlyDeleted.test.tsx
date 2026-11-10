import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import type { DeletedRow, TxSnapshot } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import type { DeletedApi, DeletedData } from '../activity/deletedApi';
import { RecentlyDeletedScreen } from './RecentlyDeletedScreen';

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

const row = (id: string, over: Partial<DeletedRow> = {}): DeletedRow => ({
  id, eventType: 'expense', amountMinor: 320_000, localDate: '2026-10-30', merchant: 'Rent', category: 'Housing', account: 'Cash', removedAtMs: 0, daysLeft: 23, ...over,
});

async function mountScreen(rows: DeletedRow[], over: Partial<DeletedApi> = {}) {
  const state = { rows };
  const snapshot = { id: 'x' } as TxSnapshot;
  const restore = jest.fn(async (id: string) => {
    state.rows = state.rows.filter((r) => r.id !== id);
    return { ok: true as const, value: { snapshot } };
  });
  const undoRestore = jest.fn(async () => ({ ok: true }));
  const purge = jest.fn(async (id: string) => {
    state.rows = state.rows.filter((r) => r.id !== id);
    return { ok: true };
  });
  const purgeFacts = jest.fn(async () => ({ isTransfer: false, hasRefund: false }));
  const api: DeletedApi = { load: async (): Promise<DeletedData> => ({ currency: 'INR', locale: 'en-IN', rows: state.rows }), restore, undoRestore, purge, purgeFacts, ...over };
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
              <RecentlyDeletedScreen api={api} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  await settle();
  return { r, restore, undoRestore, purge, purgeFacts };
}

describe('Recently deleted (Story 3.13)', () => {
  it('lists each entry with merchant, amount, original date and days left', async () => {
    const m = await mountScreen([row('a'), row('b', { merchant: 'Tea', daysLeft: 1 })]);
    const t = texts(m.r);
    expect(t).toEqual(expect.arrayContaining(['Rent', '₹3,200.00', 'Fri 30 Oct · 23 days left', 'Tea', 'Fri 30 Oct · 1 day left']));
  });

  it('with none it shows the boat and "Nothing deleted in the last 30 days"', async () => {
    const m = await mountScreen([]);
    expect(has(m.r, 'deleted-empty')).toBe(true);
    expect(texts(m.r)).toContain('Nothing deleted in the last 30 days');
  });

  it('Restore returns the entry and toasts "Restored" with Undo', async () => {
    const m = await mountScreen([row('a')]);
    await press(m.r, 'restore-a');
    expect(m.restore).toHaveBeenCalledWith('a', 'deleted');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['Restored', 'Undo']));
    expect(has(m.r, 'deleted-a')).toBe(false);
    await press(m.r, 'toast-undo');
    expect(m.undoRestore).toHaveBeenCalled();
  });

  it('Delete permanently asks first in plain words; Cancel changes nothing; Confirm purges and toasts', async () => {
    const m = await mountScreen([row('a')]);
    await press(m.r, 'purge-a');
    expect(texts(m.r)).toContain("Delete this entry permanently? This can't be undone.");
    expect(texts(m.r)).not.toContain('This is part of a transfer — both sides will be deleted');
    await press(m.r, 'purge-cancel');
    expect(m.purge).not.toHaveBeenCalled();
    await press(m.r, 'purge-a');
    await press(m.r, 'purge-confirm');
    expect(m.purge).toHaveBeenCalledWith('a');
    expect(texts(m.r)).toContain('Deleted permanently');
  });

  it('the confirm sheet adds the transfer and refund consequences', async () => {
    const m = await mountScreen([row('t')], { purgeFacts: async () => ({ isTransfer: true, hasRefund: true }) });
    await press(m.r, 'purge-t');
    expect(texts(m.r)).toEqual(expect.arrayContaining(['This is part of a transfer — both sides will be deleted', 'Its refund will stay, unlinked.']));
  });
});
