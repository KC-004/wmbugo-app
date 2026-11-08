/**
 * Shared helpers for the Add sheet tests: a fake ledger api, mounting with the providers it needs, and small
 * readers over the rendered tree. Test-only; nothing in the app imports this.
 */
import { AccessibilityInfo, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { mapCategoryRows, rankCategories, SEED_CATEGORIES, type AccountRow, type DuplicateInfo, type EntryEdit, type TransferEdit, type TxSnapshot } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { EMPTY_DRAFT, useUiStore } from '../../shared/state/uiStore';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { AddSheet, type AddPreset, type EditSpec } from './AddSheet';
import type { AddApi, AddData, AddKind, EntryRequest, RecordResult, TransferRequest, TransferResult } from './addApi';

const live: ReactTestRenderer[] = [];
const clients: ReturnType<typeof createQueryClient>[] = [];

/** Call from `afterEach`: unmounts every renderer, clears query clients, restores spies and the draft. */
export async function cleanup(): Promise<void> {
  await act(async () => new Promise((res) => setTimeout(res, 0)));
  for (const r of live.splice(0)) act(() => r.unmount());
  for (const c of clients.splice(0)) c.clear();
  jest.restoreAllMocks();
  useUiStore.setState({ addDraft: EMPTY_DRAFT });
}

/** Call from `beforeEach`: quiet accessibility APIs. */
export function quietAccessibility(): void {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockImplementation(async (ms: number) => ms);
}

export const find = (r: ReactTestRenderer, id: string, handler: string) => r.root.findAll((n) => n.props.testID === id && typeof n.props[handler] === 'function')[0]!;
export const fire = (r: ReactTestRenderer, id: string, handler = 'onPress', ...args: unknown[]) => find(r, id, handler).props[handler](...args);
export const host = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id)[0]!;
export const has = (r: ReactTestRenderer, id: string) => r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === id).length > 0;
export const texts = (r: ReactTestRenderer) => r.root.findAll((n) => n.type === Text).map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
export const settle = async () => {
  for (let i = 0; i < 3; i++) await act(async () => new Promise((res) => setTimeout(res, 0)));
};
/** Types digits and '.' on the keypad. */
export const tap = (r: ReactTestRenderer, keys: string) => {
  for (const k of keys) act(() => fire(r, k === '.' ? 'key-decimal' : `key-${k}`));
};

export const account = (id: string, name: string, over: Partial<AccountRow> = {}): AccountRow => ({
  id, name, type: 'bank', icon: 'Bank', colorToken: 'cat-indigo', sortOrder: 0, status: 'active', balanceNotSet: true, postingsMinor: 0, ...over,
});
export const cats = (kind: AddKind) =>
  mapCategoryRows(SEED_CATEGORIES.filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense')).map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i]));

export function fakeApi(over: Partial<AddData> = {}, counts = new Map<string, number>()) {
  const record = jest.fn<Promise<RecordResult>, [EntryRequest]>(async () => ({
    ok: true,
    value: { transactionId: 'tx1', accountId: 'a1' },
  }));
  const remove = jest.fn(async (...ids: string[]) => ({ ok: ids.length >= 0 }));
  const recordTransfer = jest.fn<Promise<TransferResult>, [TransferRequest]>(
    async () => ({ ok: true, value: { transactionId: 'tr1', feeTransactionId: null } }),
  );
  const defaultAccountFor = jest.fn(async (c: string) => (c === 'cat_transport' ? 'a2' : 'a1'));
  const load = jest.fn(async (kind: AddKind): Promise<AddData> => {
    const categories = cats(kind);
    return {
      currency: 'SGD', exponent: 2, locale: 'en-SG', timezoneId: 'Asia/Singapore', categories,
      quick: rankCategories(categories, counts),
      accounts: [account('a1', 'DBS'), account('a2', 'Cash wallet')],
      defaultAccountId: 'a1', blockTransfers: false, ...over,
    };
  });
  let n = 0;
  const duplicateInfo = jest.fn<Promise<DuplicateInfo | null>, [string]>(async () => ({ matchedTransactionId: 'm1', heldCategory: { id: 'cat_food', name: 'Food & Drinks' }, confirmedCategory: { id: 'cat_food', name: 'Food & Drinks' }, categoriesDiffer: false }));
  const keepBoth = jest.fn<Promise<{ ok: boolean }>, [string]>(async () => ({ ok: true }));
  const merge = jest.fn<Promise<{ ok: boolean; code?: string }>, [string, string?]>(async () => ({ ok: true }));
  const undoResolution = jest.fn<Promise<{ ok: boolean }>, [string]>(async () => ({ ok: true }));
  const editTx = jest.fn<Promise<{ ok: true; value: { snapshot: TxSnapshot } } | { ok: false; code: string }>, [string, { entry?: EntryEdit; transfer?: TransferEdit }]>(async () => ({ ok: true, value: { snapshot: { id: 'e1' } as TxSnapshot } }));
  const restoreTransaction = jest.fn<Promise<{ ok: boolean }>, [TxSnapshot]>(async () => ({ ok: true }));
  const api: AddApi = { load, defaultAccountFor, record, recordTransfer, remove, newSubmissionId: () => `sub-${++n}`, duplicateInfo, keepBoth, merge, undoResolution, edit: editTx, restoreTransaction };
  return { api, record, recordTransfer, remove, load, defaultAccountFor, duplicateInfo, keepBoth, merge, undoResolution, editTx, restoreTransaction };
}

export function mount(api: AddApi, close = jest.fn(), onNewAccount?: () => void, preset?: AddPreset, editSpec?: EditSpec) {
  const qc = createQueryClient();
  clients.push(qc);
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastHost bottomOffset={0}>
            <SheetHost>
            <AddSheet api={api} close={close} onNewAccount={onNewAccount} preset={preset} edit={editSpec} now={() => Date.UTC(2026, 10, 8, 10, 0, 0)} />
            </SheetHost>
          </ToastHost>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  });
  live.push(r);
  return { r, close, qc };
}

export async function mountReady(over: Partial<AddData> = {}, counts?: Map<string, number>, onNewAccount?: () => void, preset?: AddPreset, editSpec?: EditSpec) {
  const f = fakeApi(over, counts);
  const m = mount(f.api, jest.fn(), onNewAccount, preset, editSpec);
  await settle();
  return { ...f, ...m };
}

/** Stops a mounted renderer early (a dismissed sheet) while keeping the cleanup bookkeeping consistent. */
export function unmountNow(r: ReactTestRenderer): void {
  act(() => r.unmount());
  live.splice(live.indexOf(r), 1);
}
