import { BackHandler, Text } from 'react-native';
import { copy } from '../../shared/copy';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { mapCategoryRows, SEED_CATEGORIES, UNCATEGORISED_ID, type ReceiptDraft } from '@wmbugo/core';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { account, cleanup, fire, has, host, quietAccessibility, settle, tap, texts } from '../add/testKit';
import { ReceiptReviewScreen } from './ReceiptReviewScreen';
import type { ReceiptMatch } from '@wmbugo/core';
import type { AttachRequest, AttachTarget, ReceiptApi, ReceiptContext, SaveReceiptRequest } from './receiptApi';
import { addItem, confirmTotal, editItem, initialReview, removeItem, saveInput, setCharge, setDate, setItemCategory, setMainCategory, setTotal, viewOf } from './receiptReviewModel';
import { sampleReceiptDraft } from './sampleReceipt';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));

afterEach(cleanup);
beforeEach(quietAccessibility);

const TODAY = '2026-11-08';
const draft = (over: Partial<ReceiptDraft> = {}): ReceiptDraft => ({ ...sampleReceiptDraft('SGD', 2), total: { value: 5400, certainty: 'sure' }, date: { value: '2026-11-05', certainty: 'sure' }, ...over });
const init = (d = draft()) => initialReview(d, { mainCategoryId: 'cat_groceries', accountId: 'a1' });

describe('review model (Story 10.4)', () => {
  it('reruns the allocation after every edit and groups category totals, largest first', () => {
    let s = init();
    expect(viewOf(s, TODAY).categoryRows).toEqual([{ categoryId: 'cat_groceries', amountMinor: 5400 }]);
    s = setItemCategory(s, 1, 'cat_shopping');
    expect(viewOf(s, TODAY).categoryRows).toEqual([
      { categoryId: 'cat_groceries', amountMinor: 3780 },
      { categoryId: 'cat_shopping', amountMinor: 1620 },
    ]);
    s = setCharge(s, 'discounts', 0, 0);
    expect(viewOf(s, TODAY).allocation.state).toBe('mismatch');
  });

  it('changing the main category moves only items still following it', () => {
    let s = setItemCategory(init(), 1, 'cat_shopping');
    s = setMainCategory(s, 'cat_food');
    expect(viewOf(s, TODAY).categoryRows.map((r) => r.categoryId).sort()).toEqual(['cat_food', 'cat_shopping']);
  });

  it('blocks Save until an unsure or missing total is confirmed, and typing a total confirms it', () => {
    const unsure = init(draft({ total: { value: 5400, certainty: 'unsure' } }));
    expect(viewOf(unsure, TODAY)).toMatchObject({ canSave: false, blocked: 'total', totalNeedsConfirm: true });
    expect(viewOf(confirmTotal(unsure), TODAY).canSave).toBe(true);
    expect(viewOf(setTotal(unsure, 5400), TODAY).canSave).toBe(true);
    const missing = init(draft({ total: { value: null, certainty: 'missing' } }));
    expect(viewOf(missing, TODAY).blocked).toBe('total');
    expect(viewOf(setTotal(missing, 5400), TODAY).canSave).toBe(true);
  });

  it('keeps Save enabled for a missing or unsure date, shows today for a missing one, and a typed date clears the warning', () => {
    const missing = init(draft({ date: { value: null, certainty: 'missing' } }));
    expect(viewOf(missing, TODAY)).toMatchObject({ date: TODAY, dateUncertain: true, canSave: true });
    expect(saveInput(missing, TODAY)!.draft.date.value).toBe(TODAY);
    const unsure = init(draft({ date: { value: '2026-11-07', certainty: 'unsure' } }));
    expect(viewOf(unsure, TODAY)).toMatchObject({ date: '2026-11-07', dateUncertain: true, canSave: true });
    expect(viewOf(setDate(unsure, '2026-11-06'), TODAY).dateUncertain).toBe(false);
  });

  it('is blocked by a mismatch, and offers nothing to save', () => {
    const s = init(draft({ total: { value: 5000, certainty: 'sure' } }));
    expect(viewOf(s, TODAY)).toMatchObject({ canSave: false, blocked: 'mismatch' });
    expect(saveInput(s, TODAY)).toBeNull();
  });

  it('editing an item reruns the allocation, removing one moves its amount to Not itemised, and adding one shrinks it', () => {
    let s = init(draft({ total: { value: 5400, certainty: 'sure' } }));
    s = editItem(s, 0, { name: 'Basmati rice', amountMinor: 4000 });
    expect(s.draft.items[0]).toMatchObject({ name: 'Basmati rice', amountMinor: 4000 });
    expect(viewOf(s, TODAY).allocation).toMatchObject({ state: 'not_itemised', notItemised: 200 });
    const removed = removeItem(init(draft({ total: { value: 5400, certainty: 'sure' } })), 1);
    expect(removed.draft.items).toHaveLength(1);
    expect(removed.itemChoices).toHaveLength(1);
    expect(viewOf(removed, TODAY).allocation.state).toBe('not_itemised');
    // The Not itemised amount shrinks when a missed line is added, and a larger one is a mismatch.
    const added = addItem(removed, { name: 'Tea', amountMinor: 1800, categoryId: 'cat_food' });
    expect(viewOf(added, TODAY).allocation.state).not.toBe('mismatch');
    const tooMuch = addItem(removed, { name: 'Tea', amountMinor: 99999, categoryId: null });
    expect(viewOf(tooMuch, TODAY).allocation.state).toBe('mismatch');
    expect(addItem(removed, { name: ' ', amountMinor: 100, categoryId: null })).toBe(removed);
    // An edit cannot make an amount zero, and an item discount never passes the item.
    const base = init(draft({ total: { value: 5400, certainty: 'sure' } }));
    expect(editItem(base, 0, { amountMinor: 0 })).toBe(base);
    expect(editItem(base, 0, { amountMinor: 1.5 })).toBe(base);
    const discounted = init(draft({ items: [{ ...draft().items[0]!, discountMinor: 3000 }] }));
    expect(editItem(discounted, 0, { amountMinor: 1000 }).draft.items[0]!.discountMinor).toBe(1000);
    // An item can go back to following the main category.
    expect(setItemCategory(setItemCategory(base, 1, 'cat_shopping'), 1, null).itemChoices[1]).toBeNull();
  });

  it('only the items the person chose are reported as chosen on save', () => {
    const s = setItemCategory(init(), 1, 'cat_shopping');
    expect(saveInput(s, TODAY)!.itemCategories).toEqual([null, 'cat_shopping']);
  });

  it('shows Not itemised and still allows Save', () => {
    const s = init(draft({ total: { value: 6000, certainty: 'sure' }, subtotal: { value: null, certainty: 'missing' } }));
    const v = viewOf(s, TODAY);
    expect(v.allocation).toMatchObject({ state: 'not_itemised', notItemised: 600 });
    expect(v.canSave).toBe(true);
  });
});

const HDFC_MATCH: ReceiptMatch = { transactionId: 'm1', amountMinor: 5400, localDate: TODAY, occurredAtMs: Date.UTC(2026, 10, 8, 10, 12, 0), merchant: 'Sagar Fresh Mart', accountName: 'HDFC debit', sourceKind: 'sms', status: 'confirmed' };

function fakeApi(over: Partial<ReceiptContext> = {}, found: ReceiptMatch[] = [], itemCount = 0, target: AttachTarget | null = null) {
  const categories = mapCategoryRows(SEED_CATEGORIES.filter((c) => c.kind === 'expense').map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i, 0]) as never);
  const ctx: ReceiptContext = {
    currency: 'SGD', exponent: 2, locale: 'en-SG', timezoneId: 'Asia/Singapore', todayLocal: TODAY,
    accounts: [account('a1', 'DBS'), account('a2', 'Cash wallet', { type: 'cash' })],
    categories, quick: categories.slice(0, 6),
    defaultAccountId: 'a1', defaultCategoryId: 'cat_groceries', cashAccountId: 'a2', ...over,
  };
  const save = jest.fn<ReturnType<ReceiptApi['save']>, [SaveReceiptRequest]>(async () => ({ ok: true, value: { transactionId: 'rx1', result: 'RECORDED' } }));
  const remove = jest.fn(async (id: string) => ({ ok: id !== '' }));
  const attach = jest.fn<ReturnType<ReceiptApi['attach']>, [AttachRequest]>(async () => ({ ok: true, value: { undo: { before: {} } as never, adjustmentMinor: 0 } }));
  const undoAttach = jest.fn(async () => ({ ok: true }));
  const api: ReceiptApi = { load: jest.fn(async () => ctx), newSubmissionId: () => 'sub-1', save, remove: (id: string) => remove(id), matches: jest.fn(async () => found), entry: jest.fn(async () => target), itemCount: jest.fn(async () => itemCount), attach, undoAttach };
  return { api, save, remove, attach, undoAttach };
}

const PHOTO = { attachmentId: 'att1', digest: 'd1', sizeBytes: 10, width: 10, height: 10, provenance: 'photo_picker' as const };

async function mount(d: ReceiptDraft, over: Partial<ReceiptContext> = {}, loadFails = false, withPhoto = false, found: ReceiptMatch[] = [], itemCount = 0, attach?: { to: string; target: AttachTarget | null }) {
  const f = fakeApi(over, found, itemCount, attach?.target ?? null);
  if (loadFails) f.api.load = jest.fn(async () => { throw new Error('no profile'); });
  const onClose = jest.fn();
  const onSaved = jest.fn();
  const onDiscardPhoto = jest.fn();
  const addApi = { duplicateInfo: jest.fn(async () => null), keepBoth: jest.fn(), merge: jest.fn(), undoResolution: jest.fn() } as never;
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <ThemeProvider initialMode="light">
        <QueryClientProvider client={createQueryClient()}>
          <ToastHost>
            <SheetHost>
              <ReceiptReviewScreen draft={d} {...(attach ? { attachTo: attach.to } : {})} {...(withPhoto ? { photo: PHOTO, onDiscardPhoto } : {})} api={f.api} addApi={addApi} onClose={onClose} onSaved={onSaved} />
            </SheetHost>
          </ToastHost>
        </QueryClientProvider>
      </ThemeProvider>,
    );
  });
  await settle();
  return { r, onClose, onSaved, onDiscardPhoto, ...f };
}

describe('ReceiptReviewScreen (SCR-23)', () => {
  it('shows merchant, date, Paid with, categories, category totals, collapsed Items (N), the total and Save', async () => {
    const { r } = await mount(draft());
    const t = texts(r);
    expect(t).toEqual(expect.arrayContaining(['Sample Fresh Mart', '2026-11-05', 'DBS', 'Items (2)', 'Total']));
    expect(has(r, 'category-cat_groceries')).toBe(true);
    expect(has(r, 'total-cat_groceries')).toBe(true);
    expect(has(r, 'item-0')).toBe(false); // collapsed
    expect(host(r, 'items-toggle').props.accessibilityState).toMatchObject({ expanded: false });
    act(() => fire(r, 'items-toggle'));
    expect(has(r, 'item-0')).toBe(true);
    expect(host(r, 'items-toggle').props.accessibilityState).toMatchObject({ expanded: true });
    expect(has(r, 'receipt-save')).toBe(true);
  });

  it('an unsure total is highlighted with Check the total, then tap it to confirm, Save is disabled but focusable with its hint, and confirming enables Save', async () => {
    const { r, save } = await mount(draft({ total: { value: 5400, certainty: 'unsure' } }));
    expect(texts(r)).toContain('Check the total, then tap it to confirm');
    const btn = host(r, 'receipt-save');
    expect(btn.props.accessibilityState).toMatchObject({ disabled: true });
    expect(btn.props.accessibilityHint).toContain('Confirm the total to save');
    await act(async () => fire(r, 'receipt-save'));
    expect(save).not.toHaveBeenCalled();
    act(() => fire(r, 'row-total'));
    await settle();
    expect(host(r, 'amount-editor-text').props.children).toBe('54');
    act(() => fire(r, 'amount-editor-done'));
    await settle();
    expect(texts(r)).not.toContain('Check the total, then tap it to confirm');
    expect(host(r, 'receipt-save').props.accessibilityState).not.toMatchObject({ disabled: true });
  });

  it('a missing date shows today with date? and the TalkBack text, and Save stays enabled', async () => {
    const { r } = await mount(draft({ date: { value: null, certainty: 'missing' } }));
    expect(texts(r)).toEqual(expect.arrayContaining([TODAY, 'Date?']));
    expect(host(r, 'row-date').props.accessibilityLabel).toBe('Date, 8 Nov, not sure, double tap to change');
    expect(host(r, 'receipt-save').props.accessibilityState).not.toMatchObject({ disabled: true });
  });

  it('a mismatch shows the inline warning and disables Save with its hint', async () => {
    const { r } = await mount(draft({ total: { value: 5000, certainty: 'sure' } }));
    expect(texts(r).join(' ')).toContain('Items add up to');
    expect(texts(r).join(' ')).toContain('Fix an item, a discount or the total.');
    expect(host(r, 'receipt-save').props.accessibilityHint).toContain('Fix the difference to save');
  });

  it('shows Not itemised as a grey row with its hint, and Save is normal', async () => {
    const { r } = await mount(draft({ total: { value: 6000, certainty: 'sure' } }));
    expect(has(r, 'not-itemised')).toBe(true);
    expect(texts(r).join(' ')).toContain("Part of the total we couldn't match to an item. It counts as Uncategorised. Add the missing items to split it.");
    expect(host(r, 'receipt-save').props.accessibilityState).not.toMatchObject({ disabled: true });
  });

  it('Save sends the reviewed draft, the main category and the Paid with account once, then closes with a Saved toast and Undo', async () => {
    const { r, save, remove, onClose, onSaved } = await mount(draft());
    act(() => fire(r, 'category-cat_food'));
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toMatchObject({ submissionId: 'sub-1', mainCategoryId: 'cat_food', accountId: 'a1', createCash: false, itemCategories: [null, null] });
    expect(onSaved).toHaveBeenCalledWith('rx1');
    expect(onClose).toHaveBeenCalled();
    expect(texts(r)).toContain('Saved');
    await act(async () => fire(r, 'toast-undo'));
    expect(remove).toHaveBeenCalledWith('rx1');
  });

  it('with no account it saves with Cash to be created in the same save', async () => {
    const { r, save } = await mount(draft(), { accounts: [], defaultAccountId: null, cashAccountId: null });
    expect(texts(r)).toContain('Cash');
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(save.mock.calls[0]![0]).toMatchObject({ accountId: null, createCash: true });
  });

  it('a failed save keeps the review open with a message, and the same submission id is reused on retry', async () => {
    const { r, save, onClose } = await mount(draft());
    save.mockResolvedValueOnce({ ok: false, code: 'ERROR' });
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(texts(r)).toContain('The receipt was not saved. Try again.');
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(save.mock.calls.map((c) => c[0].submissionId)).toEqual(['sub-1', 'sub-1']);
  });

  it('saves the pending photo as the entry attachment, and discarding deletes it', async () => {
    const a = await mount(draft(), {}, false, true);
    act(() => fire(a.r, 'category-cat_food'));
    await act(async () => fire(a.r, 'receipt-save'));
    await settle();
    expect(a.save.mock.calls[0]![0]).toMatchObject({ attachment: { attachmentId: 'att1', digest: 'd1', sizeBytes: 10 } });
    expect(a.onDiscardPhoto).not.toHaveBeenCalled();
    const b = await mount(draft(), {}, false, true);
    act(() => fire(b.r, 'receipt-close'));
    await settle();
    act(() => fire(b.r, 'discard-confirm'));
    expect(b.onDiscardPhoto).toHaveBeenCalledTimes(1);
    expect(b.save).not.toHaveBeenCalled();
  });

  it('a probable match shows the prompt with its choices instead of Save, and nothing is attached without a tap', async () => {
    const a = await mount(draft(), {}, false, true, [HDFC_MATCH]);
    expect(texts(a.r)).toContain('Matches ₹54.00 HDFC debit 6:12 pm'.replace('₹', 'S$'));
    expect(has(a.r, 'receipt-save')).toBe(false);
    expect(has(a.r, 'attach-m1')).toBe(true);
    expect(has(a.r, 'keep-separate')).toBe(true);
    expect(has(a.r, 'match-discard')).toBe(true);
    expect(a.attach).not.toHaveBeenCalled();
    expect(a.save).not.toHaveBeenCalled();
    expect(texts(a.r).join(' ')).not.toMatch(/Approve|Reject/);
  });

  it('shows the date when the match is not from today', async () => {
    const a = await mount(draft(), {}, false, false, [{ ...HDFC_MATCH, localDate: '2026-11-06', occurredAtMs: Date.UTC(2026, 10, 6, 10, 12, 0) }]);
    expect(texts(a.r).some((t) => /HDFC debit · 6 Nov, 6:12 pm$/.test(t))).toBe(true);
  });

  it('lists up to three matches, each with its own Attach to it, and Keep separate and Discard once', async () => {
    const more = ['m2', 'm3'].map((id) => ({ ...HDFC_MATCH, transactionId: id }));
    const a = await mount(draft(), {}, false, false, [HDFC_MATCH, ...more]);
    expect(['m1', 'm2', 'm3'].every((id) => has(a.r, 'attach-' + id))).toBe(true);
    expect(a.r.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'keep-separate')).toHaveLength(1);
  });

  it('Attach to it attaches the reviewed receipt and the photo, toasts Receipt attached with Undo, and Undo restores', async () => {
    const a = await mount(draft(), {}, false, true, [HDFC_MATCH]);
    act(() => fire(a.r, 'category-cat_food'));
    await act(async () => fire(a.r, 'attach-m1'));
    await settle();
    expect(a.attach).toHaveBeenCalledTimes(1);
    expect(a.attach.mock.calls[0]![0]).toMatchObject({ submissionId: 'sub-1', transactionId: 'm1', mainCategoryId: 'cat_food', attachment: { attachmentId: 'att1' } });
    expect(a.save).not.toHaveBeenCalled();
    expect(texts(a.r)).toContain('Receipt attached');
    await act(async () => fire(a.r, 'toast-undo'));
    expect(a.undoAttach).toHaveBeenCalledTimes(1);
  });

  it('asks before replacing the items an entry already has', async () => {
    const a = await mount(draft(), {}, false, true, [HDFC_MATCH], 14);
    await act(async () => fire(a.r, 'attach-m1'));
    await settle();
    expect(texts(a.r)).toContain('Replace its 14 items with these 2?');
    expect(a.attach).not.toHaveBeenCalled();
    await act(async () => fire(a.r, 'keep-items'));
    await settle();
    expect(a.attach.mock.calls[0]![0]).toMatchObject({ itemsMode: 'keep', attachment: { attachmentId: 'att1' } });
  });

  it('Keep separate brings Save back and saves a new confirmed expense with keepSeparate', async () => {
    const a = await mount(draft(), {}, false, false, [HDFC_MATCH]);
    act(() => fire(a.r, 'keep-separate'));
    await settle();
    expect(has(a.r, 'receipt-save')).toBe(true);
    expect(has(a.r, 'match-prompt')).toBe(false);
    act(() => fire(a.r, 'category-cat_food'));
    await act(async () => fire(a.r, 'receipt-save'));
    await settle();
    expect(a.save.mock.calls[0]![0]).toMatchObject({ keepSeparate: true });
  });

  it('Discard writes nothing, deletes the photo, toasts Receipt discarded and closes', async () => {
    const a = await mount(draft(), {}, false, true, [HDFC_MATCH]);
    act(() => fire(a.r, 'match-discard'));
    await settle();
    expect(a.onDiscardPhoto).toHaveBeenCalledTimes(1);
    expect(a.onClose).toHaveBeenCalled();
    expect(a.attach).not.toHaveBeenCalled();
    expect(a.save).not.toHaveBeenCalled();
    expect(texts(a.r)).toContain('Receipt discarded');
  });

  it('a failed attach says nothing was changed and keeps the review open', async () => {
    const a = await mount(draft(), {}, false, false, [HDFC_MATCH]);
    a.attach.mockResolvedValueOnce({ ok: false, code: 'RECEIPT_MISMATCH' });
    await act(async () => fire(a.r, 'attach-m1'));
    await settle();
    expect(texts(a.r)).toContain('Could not attach the receipt. Nothing was changed.');
    expect(a.onClose).not.toHaveBeenCalled();
  });

  it('Back asks to discard: Keep editing returns, Discard closes and writes nothing', async () => {
    const { r, save, onClose } = await mount(draft());
    act(() => fire(r, 'receipt-close'));
    await settle();
    expect(texts(r)).toContain('Nothing will be saved.');
    act(() => fire(r, 'discard-keep'));
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    act(() => fire(r, 'receipt-close'));
    await settle();
    act(() => fire(r, 'discard-confirm'));
    expect(onClose).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('typing a new total on the keypad reruns the allocation', async () => {
    const { r } = await mount(draft());
    act(() => fire(r, 'row-total'));
    await settle();
    act(() => fire(r, 'key-clear'));
    tap(r, '50');
    act(() => fire(r, 'amount-editor-done'));
    await settle();
    expect(has(r, 'mismatch-warning')).toBe(true);
  });

  it('a possible duplicate shows the duplicate choices, not a plain Saved toast', async () => {
    const { r, save } = await mount(draft());
    save.mockResolvedValueOnce({ ok: true, value: { transactionId: 'rx2', result: 'POSSIBLE_DUPLICATE' } });
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(texts(r)).not.toContain('Saved');
    expect(texts(r)).toContain(copy.duplicate.looksRecorded);
  });

  it('choosing another Paid with account saves that account', async () => {
    const { r, save } = await mount(draft());
    act(() => fire(r, 'paid-with-chip'));
    act(() => fire(r, 'account-option-a2'));
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(save.mock.calls[0]![0]).toMatchObject({ accountId: 'a2', createCash: false });
  });

  it('with one account and no Cash account, either can be chosen', async () => {
    const { r, save } = await mount(draft(), { accounts: [account('a1', 'DBS')], defaultAccountId: null, cashAccountId: null });
    act(() => fire(r, 'paid-with-chip'));
    expect(has(r, 'account-option-cash')).toBe(true);
    act(() => fire(r, 'account-option-a1'));
    act(() => fire(r, 'paid-with-chip'));
    act(() => fire(r, 'account-option-cash'));
    act(() => fire(r, 'paid-with-chip'));
    act(() => fire(r, 'account-option-a1'));
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(save.mock.calls[0]![0]).toMatchObject({ accountId: 'a1', createCash: false });
  });

  it('a receipt read in another currency can be put right before saving', async () => {
    const { r, save } = await mount(draft({ currency: { value: 'USD', certainty: 'unsure' } }));
    expect(texts(r).join(' ')).not.toContain('{profile}');
    act(() => fire(r, 'row-currency'));
    expect(has(r, 'row-currency')).toBe(false);
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(save.mock.calls[0]![0].draft.currency.value).toBe('SGD');
  });

  it('rows and totals speak their values', async () => {
    const { r } = await mount(draft());
    expect(host(r, 'row-merchant').props.accessibilityLabel).toBe('Merchant, Sample Fresh Mart, double tap to change');
    expect(host(r, 'row-discounts-0').props.accessibilityLabel).toContain('S$6.00');
    expect(host(r, 'total-cat_groceries').props.accessibilityLabel).toMatch(/^Groceries, 54 .*dollars/);
    act(() => fire(r, 'items-toggle'));
    expect(host(r, 'item-chip-0').props.accessibilityLabel).toBe('Category: Groceries');
  });

  it('refuses a date after today in the date editor', async () => {
    const { r } = await mount(draft());
    act(() => fire(r, 'row-date'));
    await settle();
    act(() => fire(r, 'text-editor-input', 'onChangeText', '2026-11-09'));
    act(() => fire(r, 'text-editor-done'));
    await settle();
    expect(texts(r)).toContain(copy.receiptReview.dateFuture);
  });

  it('shows the first four categories, keeping the chosen one among them, and no photo placeholder', async () => {
    const all = mapCategoryRows(SEED_CATEGORIES.filter((c) => c.kind === 'expense').map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i, 0]) as never);
    const { r } = await mount(draft(), { quick: all.slice(0, 4), defaultCategoryId: all[8]!.id }, false, true);
    expect(has(r, `category-${all[8]!.id}`)).toBe(true);
    expect(has(r, `category-${all[3]!.id}`)).toBe(false);
    expect(has(r, 'receipt-thumb')).toBe(false);
  });

  it('Android Back asks to discard, and closes at once while the review has not loaded', async () => {
    const listeners: (() => boolean | null | undefined)[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, f) => {
      listeners.push(f as () => boolean);
      return { remove: () => undefined };
    });
    const loaded = await mount(draft());
    act(() => void listeners[listeners.length - 1]!());
    await settle();
    expect(texts(loaded.r)).toContain('Nothing will be saved.');
    expect(loaded.onClose).not.toHaveBeenCalled();
    listeners.length = 0;
    const failed = await mount(draft(), {}, true);
    act(() => void listeners[0]!());
    expect(failed.onClose).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('another currency shows its own message, and an impossible date its own', async () => {
    const { r, save } = await mount(draft({ currency: { value: 'USD', certainty: 'sure' } }));
    save.mockResolvedValueOnce({ ok: false, code: 'CURRENCY_DIFFERS' });
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(texts(r).join(' ')).toContain('This receipt is in USD, which cannot be saved yet.');
    save.mockResolvedValueOnce({ ok: false, code: 'DATE_INVALID' });
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(texts(r)).toContain('Use a real date, like 2026-11-07.');
  });

  it('typing an impossible date keeps the sheet open with a message, and a real date is taken', async () => {
    const { r } = await mount(draft());
    act(() => fire(r, 'row-date'));
    await settle();
    act(() => fire(r, 'text-editor-input', 'onChangeText', '2026-02-31'));
    act(() => fire(r, 'text-editor-done'));
    await settle();
    expect(has(r, 'text-editor-error')).toBe(true);
    act(() => fire(r, 'text-editor-input', 'onChangeText', '2026-11-06'));
    act(() => fire(r, 'text-editor-done'));
    await settle();
    expect(texts(r)).toContain('2026-11-06');
  });

  it('edits the merchant, and a discount can be corrected to nothing (which makes the items add up to more than the total)', async () => {
    const { r } = await mount(draft());
    act(() => fire(r, 'row-merchant'));
    await settle();
    act(() => fire(r, 'text-editor-input', 'onChangeText', 'Corner Store'));
    act(() => fire(r, 'text-editor-done'));
    await settle();
    expect(texts(r)).toContain('Corner Store');
    act(() => fire(r, 'row-discounts-0'));
    await settle();
    act(() => fire(r, 'key-clear'));
    act(() => fire(r, 'amount-editor-done'));
    await settle();
    expect(has(r, 'mismatch-warning')).toBe(true);
  });

  it('two quick taps on Save save once', async () => {
    const { r, save } = await mount(draft());
    await act(async () => {
      void fire(r, 'receipt-save');
      void fire(r, 'receipt-save');
    });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a load that fails shows a message and a way out', async () => {
    const { r, onClose } = await mount(draft(), {}, true);
    expect(has(r, 'receipt-load-failed')).toBe(true);
    act(() => fire(r, 'receipt-load-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('an item gets its own category from its chip, the totals regroup without collapsing the list, and save reports only that item as chosen', async () => {
    const { r, save } = await mount(draft());
    act(() => fire(r, 'items-toggle'));
    act(() => fire(r, 'item-chip-1'));
    await settle();
    act(() => fire(r, 'pick-category-cat_shopping'));
    await settle();
    expect(has(r, 'item-1')).toBe(true); // still open
    expect(has(r, 'total-cat_shopping')).toBe(true);
    expect(has(r, 'total-cat_groceries')).toBe(true);
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(save.mock.calls[0]![0].itemCategories).toEqual([null, 'cat_shopping']);
  });

  it('the custom action Change category on an item row opens the same picker', async () => {
    const { r } = await mount(draft());
    act(() => fire(r, 'items-toggle'));
    const row = host(r, 'item-0');
    expect(row.props.accessibilityActions).toEqual([{ name: 'changeCategory', label: 'Change category' }]);
    act(() => row.props.onAccessibilityAction({ nativeEvent: { actionName: 'changeCategory' } }));
    await settle();
    expect(has(r, 'pick-category-cat_food')).toBe(true);
  });

  it('shows an item discount under the item', async () => {
    const d = draft();
    const { r } = await mount({ ...d, items: [{ ...d.items[0]!, discountMinor: 100 }, d.items[1]!], total: { value: 5300, certainty: 'sure' } });
    act(() => fire(r, 'items-toggle'));
    expect(texts(r).join(' ')).toContain('Discount');
  });

  it('edits an item name and amount, removes an item (its amount moves to Not itemised), and adds a missed line', async () => {
    const { r } = await mount(draft());
    act(() => fire(r, 'items-toggle'));
    act(() => fire(r, 'item-edit-1'));
    await settle();
    act(() => fire(r, 'item-name-input', 'onChangeText', 'Dish soap large'));
    act(() => fire(r, 'item-save'));
    await settle();
    expect(texts(r)).toContain('Dish soap large');
    act(() => fire(r, 'item-edit-1'));
    await settle();
    act(() => fire(r, 'item-remove'));
    await settle();
    expect(has(r, 'item-1')).toBe(false);
    expect(has(r, 'not-itemised')).toBe(true);
    act(() => fire(r, 'add-item'));
    await settle();
    act(() => fire(r, 'item-name-input', 'onChangeText', 'Lemons'));
    act(() => fire(r, 'item-amount-input', 'onChangeText', '5'));
    act(() => fire(r, 'item-category-cat_food'));
    act(() => fire(r, 'item-save'));
    await settle();
    expect(texts(r)).toContain('Lemons');
    act(() => fire(r, 'item-edit-1'));
    await settle();
    act(() => fire(r, 'item-amount-input', 'onChangeText', '0'));
    act(() => fire(r, 'item-save'));
    await settle();
    expect(has(r, 'item-error')).toBe(true);
  });

  it('can add an item when the items already make the total, and with no items read', async () => {
    const full = await mount(draft());
    act(() => fire(full.r, 'items-toggle'));
    expect(has(full.r, 'add-item')).toBe(true);
    const none = await mount(draft({ items: [], discounts: [] }));
    act(() => fire(none.r, 'add-item'));
    await settle();
    act(() => fire(none.r, 'item-name-input', 'onChangeText', 'Tea'));
    act(() => fire(none.r, 'item-amount-input', 'onChangeText', '5'));
    act(() => fire(none.r, 'item-save'));
    await settle();
    expect(has(none.r, 'items-toggle')).toBe(true);
  });

  it('removes a charge and adds a tax, rerunning the allocation', async () => {
    const { r, save } = await mount(draft({ total: { value: 5900, certainty: 'sure' } }));
    act(() => fire(r, 'row-discounts-0'));
    await settle();
    act(() => fire(r, 'charge-remove'));
    await settle();
    expect(has(r, 'row-discounts-0')).toBe(false);
    expect(has(r, 'mismatch-warning')).toBe(true);
    act(() => fire(r, 'row-total'));
    await settle();
    act(() => fire(r, 'key-clear'));
    tap(r, '63');
    act(() => fire(r, 'amount-editor-done'));
    await settle();
    act(() => fire(r, 'add-tax'));
    await settle();
    expect(has(r, 'charge-remove')).toBe(false);
    tap(r, '3');
    act(() => fire(r, 'amount-editor-done'));
    await settle();
    expect(has(r, 'row-taxes-0')).toBe(true);
    await act(async () => fire(r, 'receipt-save'));
    await settle();
    expect(save.mock.calls[0]![0].draft.taxes.map((t) => t.value)).toEqual([300]);
    expect(save.mock.calls[0]![0].draft.discounts).toEqual([]);
  });

  it('with no history the main category is Uncategorised', async () => {
    const { r } = await mount(draft(), { defaultCategoryId: UNCATEGORISED_ID });
    expect(has(r, `total-${UNCATEGORISED_ID}`)).toBe(true);
  });

  it('every text is a string from the catalogue (no raw text node is empty)', async () => {
    const { r } = await mount(draft());
    expect(r.root.findAll((n) => n.type === Text).every((n) => n.props.children !== undefined)).toBe(true);
  });
});
