import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClientProvider } from '@tanstack/react-query';
import { mapCategoryRows, SEED_CATEGORIES, type OcrEngine, type OcrResult } from '@wmbugo/core';
import type { ReceiptScanFiles } from '../../adapters/files/receiptFiles';
import { SheetHost } from '../../shared/feedback/SheetHost';
import { ToastHost } from '../../shared/feedback/ToastHost';
import { createQueryClient } from '../../shared/queryClient';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { account, cleanup, fire, has, quietAccessibility, settle, texts } from '../add/testKit';
import type { AttachRequest, AttachTarget, ReceiptApi, ReceiptContext } from './receiptApi';
import { ReceiptScanFlow } from './ReceiptScanFlow';
import type { ScanApi } from './receiptScanApi';
import { SCAN_ORIGINS, scanLinkRequest, startReceiptScan, type ScanNav, type ScanParams } from './startReceiptScan';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));
jest.mock('../../adapters/permissions', () => ({ requestPermission: jest.fn(), permissionState: jest.fn() }));

afterEach(cleanup);
beforeEach(quietAccessibility);

describe('startReceiptScan, the one entry (Story 10.9)', () => {
  const nav = () => {
    const calls: { screen: string; params: ScanParams }[] = [];
    const n: ScanNav = { navigate: (screen, params) => void calls.push({ screen, params }) };
    return { n, calls };
  };

  it.each(SCAN_ORIGINS)('%s opens the camera, and with an image goes straight to intake and reading', (origin) => {
    const a = nav();
    startReceiptScan(a.n, { origin });
    expect(a.calls).toEqual([{ screen: 'ReceiptCamera', params: { origin } }]);
    const b = nav();
    startReceiptScan(b.n, { origin, imageUri: 'content://shared/1' });
    expect(b.calls).toEqual([{ screen: 'ReceiptScan', params: { origin, uri: 'content://shared/1', provenance: 'photo_picker' } }]);
  });

  it('carries attachTo into attach mode', () => {
    const a = nav();
    startReceiptScan(a.n, { origin: 'entry_detail', attachTo: 'tx9' });
    expect(a.calls[0]).toEqual({ screen: 'ReceiptCamera', params: { origin: 'entry_detail', attachTo: 'tx9' } });
  });

  it('maps the deep link wmbugo://receipt/scan?attachTo=<id> and nothing else', () => {
    expect(scanLinkRequest('wmbugo://receipt/scan?attachTo=tx9')).toEqual({ origin: 'widget', attachTo: 'tx9' });
    expect(scanLinkRequest('wmbugo://receipt/scan')).toEqual({ origin: 'widget' });
    expect(scanLinkRequest('wmbugo://receipt/scan?origin=notification&attachTo=a%20b')).toEqual({ origin: 'notification', attachTo: 'a b' });
    expect(scanLinkRequest('wmbugo://receipt/scan?origin=bogus')).toEqual({ origin: 'widget' });
    expect(scanLinkRequest('wmbugo://receipt/other')).toBeNull();
    expect(scanLinkRequest('https://example.com/receipt/scan')).toBeNull();
  });
});

const block = (text: string, top: number, right = 400) => ({ text, box: { left: 10, top, right, bottom: top + 20 }, confidence: 0.95 });
const OCR: OcrResult = { width: 400, height: 600, blocks: [block('Green Grocer', 10, 200), block('Rice 5kg  12.00', 100), block('Milk  3.00', 130), block('Total  15.00', 200)] };

function scanApi(): ScanApi {
  const files = {
    pick: jest.fn(async () => 'content://picked/1'),
    prepare: jest.fn(async () => ({ digest: 'd'.repeat(64), size: 100, width: 100, height: 100 })),
    viewPath: jest.fn(async () => '/cache/p.img'),
    remove: jest.fn(async () => undefined),
    clearViewCache: jest.fn(async () => undefined),
  } as unknown as ReceiptScanFiles;
  const engine: OcrEngine = { recognise: jest.fn(async () => OCR) };
  return { files, engine, newId: () => 'att1', findByDigest: async () => null, profile: async () => ({ region: 'SG', currency: 'SGD' }) };
}

const TODAY = '2026-11-08';
function receiptApi(target: AttachTarget | null) {
  const categories = mapCategoryRows(SEED_CATEGORIES.filter((c) => c.kind === 'expense').map((c, i) => [c.id, c.name, c.kind, c.budgetType, c.icon, c.color, i, 0]) as never);
  const ctx: ReceiptContext = { currency: 'SGD', exponent: 2, locale: 'en-SG', timezoneId: 'Asia/Singapore', todayLocal: TODAY, accounts: [account('a1', 'DBS')], categories, quick: categories.slice(0, 6), defaultAccountId: 'a1', defaultCategoryId: 'cat_groceries', cashAccountId: null };
  const attach = jest.fn<ReturnType<ReceiptApi['attach']>, [AttachRequest]>(async () => ({ ok: true, value: { undo: { before: {} } as never, adjustmentMinor: 0 } }));
  const api: ReceiptApi = {
    load: jest.fn(async () => ctx),
    newSubmissionId: () => 'sub-1',
    save: jest.fn(async () => ({ ok: true as const, value: { transactionId: 'rx1', result: 'RECORDED' as const } })),
    remove: jest.fn(async () => ({ ok: true })),
    matches: jest.fn(async () => []),
    entry: jest.fn(async () => target),
    itemCount: jest.fn(async () => 0),
    attach,
    undoAttach: jest.fn(async () => ({ ok: true })),
  };
  return { api, attach };
}

function mountFlow(over: { attachTo?: string; target?: AttachTarget | null; uri?: string } = {}) {
  const recorded = receiptApi(over.target ?? null);
  const scan = scanApi();
  const cb = { onLeave: jest.fn(), onByHand: jest.fn(), onOpenEntry: jest.fn(), onClose: jest.fn() };
  const qc = createQueryClient();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <ThemeProvider initialMode="light">
        <QueryClientProvider client={qc}>
          <ToastHost>
            <SheetHost>
              <ReceiptScanFlow scanApi={scan} receiptApi={recorded.api} {...(over.uri ? { uri: over.uri } : {})} {...(over.attachTo ? { attachTo: over.attachTo } : {})} {...cb} />
            </SheetHost>
          </ToastHost>
        </QueryClientProvider>
      </ThemeProvider>,
    );
  });
  return { r, scan, ...recorded, ...cb };
}

const reach = async (r: ReactTestRenderer) => {
  await act(async () => new Promise((res) => setTimeout(res, 700)));
  await settle();
  expect(has(r, 'receipt-review')).toBe(true);
};

describe('every receipt source reaches the review (Story 10.9)', () => {
  it.each(SCAN_ORIGINS)('a scan from %s reads the image and opens the review', async (origin) => {
    // The origin only decides how the scan was started; each reaches intake, reading and the review the same way.
    const nav: ScanParams = { origin, uri: 'content://image/1', provenance: 'photo_picker' };
    const m = mountFlow({ uri: nav.uri! });
    await reach(m.r);
    expect(m.scan.files.prepare).toHaveBeenCalledWith('content://image/1', 'att1');
    expect(has(m.r, 'receipt-save')).toBe(true);
  });
});

describe('attach mode: Snap receipt to split (Story 10.9)', () => {
  const entry = (amountMinor: number): AttachTarget => ({ amountMinor, accountName: 'HDFC debit', occurredAtMs: Date.UTC(2026, 10, 8, 10, 12, 0), localDate: TODAY });

  it('opens with the header Splitting ..., no match prompt, and the footer Attach and split', async () => {
    const m = await (async () => {
      const x = mountFlow({ uri: 'file:///x.jpg', attachTo: 'tx1', target: entry(1500) });
      await reach(x.r);
      return x;
    })();
    expect(texts(m.r)).toContain('Splitting S$15.00 · HDFC debit · 6:12 pm');
    expect(has(m.r, 'match-prompt')).toBe(false);
    expect(m.api.matches).not.toHaveBeenCalled();
    expect(texts(m.r)).toContain('Attach and split');
    expect(has(m.r, 'receipt-save')).toBe(false);
  });

  it('Attach and split commits through AttachReceipt with the photo and toasts Receipt attached with Undo', async () => {
    const m = mountFlow({ uri: 'file:///x.jpg', attachTo: 'tx1', target: entry(1500) });
    await reach(m.r);
    act(() => fire(m.r, 'category-cat_food'));
    await act(async () => fire(m.r, 'split-attach'));
    await settle();
    expect(m.attach).toHaveBeenCalledTimes(1);
    expect(m.attach.mock.calls[0]![0]).toMatchObject({ transactionId: 'tx1', mainCategoryId: 'cat_food', attachment: { attachmentId: 'att1' } });
    expect(m.api.save).not.toHaveBeenCalled();
    expect(texts(m.r)).toContain('Receipt attached');
    expect(has(m.r, 'toast-undo')).toBe(true);
    expect(m.onClose).toHaveBeenCalled();
  });

  it('a receipt lower than the entry shows what will be shown as Tip / adjustment', async () => {
    const m = mountFlow({ uri: 'file:///x.jpg', attachTo: 'tx1', target: entry(1760) });
    await reach(m.r);
    expect(texts(m.r)).toContain('S$2.60 will be shown as Tip / adjustment');
  });

  it('a receipt higher than the entry warns, disables Attach and split and offers Attach photo only', async () => {
    const m = mountFlow({ uri: 'file:///x.jpg', attachTo: 'tx1', target: entry(1000) });
    await reach(m.r);
    expect(texts(m.r)).toContain('This receipt totals S$15.00 but the entry is S$10.00. Check the total, or attach the photo only.');
    const attachButton = m.r.root.findAll((n) => n.props.testID === 'split-attach' && typeof n.props.onPress === 'function')[0]!;
    expect(attachButton.props.disabled === true || attachButton.props.accessibilityState?.disabled === true || attachButton.props.disabledReason !== undefined).toBe(true);
    await act(async () => fire(m.r, 'split-photo-only'));
    await settle();
    expect(m.attach.mock.calls[0]![0]).toMatchObject({ transactionId: 'tx1', photoOnly: true, attachment: { attachmentId: 'att1' } });
  });

  it('says the entry was removed when it is gone, and writes nothing', async () => {
    const m = mountFlow({ uri: 'file:///x.jpg', attachTo: 'tx1', target: null });
    await reach(m.r);
    expect(texts(m.r)).toContain('This entry was removed. Nothing was changed.');
    expect(m.attach).not.toHaveBeenCalled();
  });

  it('an entry removed while she scans: the attach is refused with the inline error and nothing changes', async () => {
    const m = mountFlow({ uri: 'file:///x.jpg', attachTo: 'tx1', target: entry(1500) });
    await reach(m.r);
    m.attach.mockResolvedValueOnce({ ok: false, code: 'ENTRY_REMOVED' });
    await act(async () => fire(m.r, 'split-attach'));
    await settle();
    expect(texts(m.r)).toContain('This entry was removed. Nothing was changed.');
    expect(m.onClose).not.toHaveBeenCalled();
  });
});
