import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { CANCELLED, OCR_UNAVAILABLE, type OcrEngine, type OcrResult } from '@wmbugo/core';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import { createOcrEngine } from '../../adapters/ocr/ocrEngine';
import type { ReceiptScanFiles } from '../../adapters/files/receiptFiles';
import { cleanup, fire, has, quietAccessibility, settle, texts } from '../add/testKit';
import { ReceiptScanScreen } from './ReceiptScanScreen';
import { intakePhoto, readPhoto, type ScanApi } from './receiptScanApi';

jest.mock('../../adapters/startApp', () => ({ getServices: jest.fn(), systemClock: { nowMs: () => 0, timezoneId: () => 'Asia/Singapore' } }));
jest.mock('../../adapters/permissions', () => ({ requestPermission: jest.fn() }));

afterEach(cleanup);
beforeEach(quietAccessibility);

const block = (text: string, top: number, right = 400) => ({ text, box: { left: 10, top, right, bottom: top + 20 }, confidence: 0.95 });
const RECEIPT: OcrResult = {
  width: 400,
  height: 600,
  blocks: [block('Green Grocer', 10, 200), block('Rice 5kg  12.00', 100), block('Milk  3.00', 130), block('Total  15.00', 200)],
};

function fakeFiles(over: Partial<ReceiptScanFiles> = {}) {
  const removed: string[] = [];
  const files: ReceiptScanFiles = {
    pick: jest.fn(async () => 'content://picked/1'),
    prepare: jest.fn(async () => ({ digest: 'd1', size: 1234.4, width: 1000, height: 1500 })),
    importPhoto: jest.fn(),
    viewPath: jest.fn(async () => '/cache/p.img'),
    remove: jest.fn(async (id: string) => void removed.push(id)),
    clearViewCache: jest.fn(async () => undefined),
    sweep: jest.fn(async () => 0),
    ...over,
  } as unknown as ReceiptScanFiles;
  return { files, removed };
}

function fakeApi(over: Partial<ScanApi> = {}, filesOver: Partial<ReceiptScanFiles> = {}) {
  const { files, removed } = fakeFiles(filesOver);
  const engine: OcrEngine = { recognise: jest.fn(async () => RECEIPT) };
  const api: ScanApi = { files, engine, newId: () => 'att1', findByDigest: async () => null, profile: async () => ({ region: 'SG', currency: 'SGD' }), ...over };
  return { api, removed };
}

describe('intake (Story 10.6)', () => {
  it('takes one processed copy in as a pending photo with its provenance', async () => {
    const { api } = fakeApi();
    const out = await intakePhoto(api, 'content://picked/1', 'photo_picker');
    expect(out).toEqual({ kind: 'ready', photo: { attachmentId: 'att1', digest: 'd1', sizeBytes: 1234, width: 1000, height: 1500, provenance: 'photo_picker' } });
  });

  it('stops at a photo whose digest is already saved and writes nothing', async () => {
    const { api, removed } = fakeApi({ findByDigest: async () => 'tx9' });
    expect(await intakePhoto(api, 'u', 'photo_picker')).toEqual({ kind: 'duplicate', transactionId: 'tx9' });
    expect(removed).toEqual(['att1']);
  });

  it('removes a half-written copy when processing fails', async () => {
    const { api, removed } = fakeApi({}, { prepare: jest.fn(async () => { throw new Error('bad image'); }) });
    expect(await intakePhoto(api, 'u', 'camera')).toEqual({ kind: 'failed' });
    expect(removed).toEqual(['att1']);
  });
});

const PHOTO = { attachmentId: 'att1', digest: 'd1', sizeBytes: 10, width: 10, height: 10, provenance: 'photo_picker' as const };

describe('reading (Story 10.6)', () => {
  it('reads a draft from the engine output and clears the plain copy afterwards', async () => {
    const { api } = fakeApi();
    const paths: string[] = [];
    const out = await readPhoto(api, PHOTO, new AbortController().signal, (p) => paths.push(p));
    expect(out.kind).toBe('read');
    if (out.kind === 'read') expect(out.draft.total.value).toBe(1500);
    expect(paths).toEqual(['/cache/p.img']);
    expect(api.files.clearViewCache).toHaveBeenCalled();
  });

  it('reports UNREADABLE when no amounts were found', async () => {
    const { api } = fakeApi({ engine: { recognise: async () => ({ width: 10, height: 10, blocks: [] }) } });
    expect(await readPhoto(api, PHOTO, new AbortController().signal)).toEqual({ kind: 'failed', reason: 'unreadable' });
  });

  it('maps OCR_UNAVAILABLE and any other engine error to unavailable', async () => {
    const a = fakeApi({ engine: { recognise: async () => { throw { code: OCR_UNAVAILABLE }; } } });
    expect(await readPhoto(a.api, PHOTO, new AbortController().signal)).toEqual({ kind: 'failed', reason: 'unavailable' });
    const b = fakeApi({ engine: { recognise: async () => { throw new Error('boom'); } } });
    expect(await readPhoto(b.api, PHOTO, new AbortController().signal)).toEqual({ kind: 'failed', reason: 'unavailable' });
  });

  it('offers another try when one read fails', async () => {
    const { api } = fakeApi({ engine: createOcrEngine(() => ({ recognise: async () => Promise.reject(Object.assign(new Error('out of memory'), { code: 'E_FAILED' })), cancel: async () => undefined })) });
    expect(await readPhoto(api, PHOTO, new AbortController().signal)).toEqual({ kind: 'failed', reason: 'unreadable' });
    const gone = fakeApi({ engine: createOcrEngine(() => ({ recognise: async () => Promise.reject(Object.assign(new Error('no models'), { code: 'E_UNAVAILABLE' })), cancel: async () => undefined })) });
    expect(await readPhoto(gone.api, PHOTO, new AbortController().signal)).toEqual({ kind: 'failed', reason: 'unavailable' });
  });

  it('gives up after the time limit', async () => {
    const never: OcrEngine = { recognise: (_i, s) => new Promise((_r, rej) => s.addEventListener('abort', () => rej({ code: CANCELLED }))) };
    const { api } = fakeApi({ engine: never, timeoutMs: 20 });
    expect(await readPhoto(api, PHOTO, new AbortController().signal)).toEqual({ kind: 'failed', reason: 'timeout' });
  });

  it('is cancelled by the caller, not reported as a failure', async () => {
    const never: OcrEngine = { recognise: (_i, s) => new Promise((_r, rej) => s.addEventListener('abort', () => rej({ code: CANCELLED }))) };
    const { api } = fakeApi({ engine: never });
    const ctl = new AbortController();
    const p = readPhoto(api, PHOTO, ctl.signal);
    setTimeout(() => ctl.abort(), 5);
    expect(await p).toEqual({ kind: 'cancelled' });
  });
});

describe('the OcrEngine adapter', () => {
  it('says OCR_UNAVAILABLE when the engine is not in the build, and never invents text', async () => {
    const engine = createOcrEngine(() => undefined);
    await expect(engine.recognise('/p', new AbortController().signal)).rejects.toEqual({ code: OCR_UNAVAILABLE, detail: 'No engine in this build' });
  });

  it('rejects CANCELLED without starting when already aborted, and aborts a running read', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const recognise = jest.fn();
    await expect(createOcrEngine(() => ({ recognise, cancel: async () => undefined })).recognise('/p', ctl.signal)).rejects.toEqual({ code: CANCELLED });
    expect(recognise).not.toHaveBeenCalled();

    const cancel = jest.fn(async () => undefined);
    const live = new AbortController();
    const engine = createOcrEngine(() => ({ recognise: () => new Promise(() => undefined), cancel }));
    const p = engine.recognise('/p', live.signal);
    live.abort();
    await expect(p).rejects.toEqual({ code: CANCELLED });
    expect(cancel).toHaveBeenCalled();
  });

  it('maps boxes and rejects an image of no size', async () => {
    const ok = createOcrEngine(() => ({ recognise: async () => ({ width: 10, height: 20, blocks: [{ text: 'a', left: 1, top: 2, right: 3, bottom: 4, confidence: null }] }), cancel: async () => undefined }));
    expect(await ok.recognise('/p', new AbortController().signal)).toEqual({ width: 10, height: 20, blocks: [{ text: 'a', box: { left: 1, top: 2, right: 3, bottom: 4 }, confidence: null }] });
    const bad = createOcrEngine(() => ({ recognise: async () => ({ width: 0, height: 0, blocks: [] }), cancel: async () => undefined }));
    await expect(bad.recognise('/p', new AbortController().signal)).rejects.toMatchObject({ code: OCR_UNAVAILABLE });
  });
});

function mount(api: ScanApi, props: Partial<React.ComponentProps<typeof ReceiptScanScreen>> = {}) {
  const cb = { onCancel: jest.fn(), onRead: jest.fn(), onByHand: jest.fn(), onOpenEntry: jest.fn() };
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <ThemeProvider>
        <ReceiptScanScreen api={api} {...cb} {...props} />
      </ThemeProvider>,
    );
  });
  return { r, ...cb };
}

describe('the scan screen (Story 10.6)', () => {
  it('opens the picker (no permission asked), reads, reveals the items and hands the draft and photo to the review', async () => {
    const { requestPermission } = jest.requireMock('../../adapters/permissions') as { requestPermission: jest.Mock };
    const { api } = fakeApi();
    const { r, onRead } = mount(api);
    await settle();
    expect(api.files.pick).toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    await act(async () => new Promise((res) => setTimeout(res, 600)));
    expect(onRead).toHaveBeenCalledTimes(1);
    const [draft, photo] = onRead.mock.calls[0];
    expect(draft.total.value).toBe(1500);
    expect(photo).toMatchObject({ attachmentId: 'att1', provenance: 'photo_picker' });
    expect(texts(r).some((t) => t.includes('items'))).toBe(true);
  });

  it('shows the title and reassurance while it reads, without a scan line when motion is reduced', async () => {
    const never: OcrEngine = { recognise: () => new Promise(() => undefined) };
    const { api } = fakeApi({ engine: never });
    const { r } = mount(api);
    await settle();
    expect(texts(r)).toEqual(expect.arrayContaining(['Reading receipt…', 'Nothing is saved yet.']));
    expect(has(r, 'scan-line')).toBe(false);
    expect(has(r, 'scan-progress-bar')).toBe(true);
  });

  it('cancelling aborts the read, deletes the pending photo and writes nothing', async () => {
    const never: OcrEngine = { recognise: () => new Promise(() => undefined) };
    const { api, removed } = fakeApi({ engine: never });
    const { r, onCancel, onRead } = mount(api);
    await settle();
    act(() => fire(r, 'scan-cancel'));
    expect(onCancel).toHaveBeenCalled();
    expect(removed).toEqual(['att1']);
    expect(onRead).not.toHaveBeenCalled();
  });

  it('closes quietly when the picker is dismissed', async () => {
    const { api } = fakeApi({}, { pick: jest.fn(async () => null) });
    const { onCancel } = mount(api);
    await settle();
    expect(onCancel).toHaveBeenCalled();
  });

  it('offers Try again and Enter it by hand after an unreadable receipt, and keeps the photo for the entry', async () => {
    const engine: OcrEngine = { recognise: async () => ({ width: 10, height: 10, blocks: [] }) };
    const { api, removed } = fakeApi({ engine });
    const { r, onByHand } = mount(api);
    await settle();
    expect(texts(r)).toContain("Couldn't read this receipt. Nothing was saved.");
    expect(has(r, 'scan-retry')).toBe(true);
    act(() => fire(r, 'scan-by-hand'));
    expect(onByHand).toHaveBeenCalledWith(expect.objectContaining({ attachmentId: 'att1' }));
    act(() => r.unmount());
    expect(removed).toEqual([]);
  });

  it('says reading is not working on this phone when the engine is unavailable, with no retry and no download', async () => {
    const engine: OcrEngine = { recognise: async () => { throw { code: OCR_UNAVAILABLE }; } };
    const { api } = fakeApi({ engine });
    const { r } = mount(api);
    await settle();
    expect(texts(r)).toContain("Receipt reading isn't working on this phone. Nothing was saved.");
    expect(has(r, 'scan-retry')).toBe(false);
    expect(has(r, 'scan-by-hand')).toBe(true);
  });

  it('says This receipt is already saved with Open it, and reads nothing', async () => {
    const { api } = fakeApi({ findByDigest: async () => 'tx9' });
    const { r, onOpenEntry } = mount(api);
    await settle();
    expect(texts(r)).toContain('This receipt is already saved');
    expect(api.engine.recognise).not.toHaveBeenCalled();
    act(() => fire(r, 'scan-open-it'));
    expect(onOpenEntry).toHaveBeenCalledWith('tx9');
  });

  it('takes a ready image (camera or share) straight to intake without the picker', async () => {
    const { api } = fakeApi();
    const { onRead } = mount(api, { uri: 'file:///x.jpg', provenance: 'camera' });
    await act(async () => new Promise((res) => setTimeout(res, 600)));
    expect(onRead).toHaveBeenCalled();
    expect(api.files.pick).not.toHaveBeenCalled();
    expect(api.files.prepare).toHaveBeenCalledWith('file:///x.jpg', 'att1');
  });
});

// keep the Text import used by the testKit helpers
void Text;
